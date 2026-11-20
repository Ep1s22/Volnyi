/**
 * Сервер сайта студии анимации «Волнуй».
 * Только встроенные модули Node.js (>= 22.13) — npm install не нужен.
 *   node server.js        → http://localhost:8081
 * БД: SQLite-файл db/volnuy.db, создаётся из db/schema.sql + db/seed.sql при первом запуске.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  console.error(`Нужен Node.js 22.13 или новее (сейчас ${process.version}). Скачайте с https://nodejs.org`);
  process.exit(1);
}
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 8081;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DB_FILE = path.join(ROOT, 'db', 'volnuy.db');

/* ------------------------------------------------------------------ БД */
const isNew = !fs.existsSync(DB_FILE);
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8'));
if (isNew) {
  db.exec(fs.readFileSync(path.join(ROOT, 'db', 'seed.sql'), 'utf8'));
  console.log('База данных создана и заполнена: db/volnuy.db');
}

const q = {
  all: (sql, ...p) => db.prepare(sql).all(...p),
  get: (sql, ...p) => db.prepare(sql).get(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p),
};

/* --------------------------------------------------------- Опыт и уровни */
const XP = { view: 10, review: 15, spin: 5, newCard: 20 };
const addXp = (userId, amount) => q.run('UPDATE users SET xp = xp + ? WHERE id = ?', amount, userId);
const levelOf = (xp) => ({ level: Math.floor(xp / 100) + 1, progress: xp % 100, need: 100 });

/* ------------------------------------------------------------ Пароли */
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function checkPassword(password, salt, hash) {
  const h = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
}

/* ------------------------------------------------------------- Сессии */
const SESSION_DAYS = 30;
function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  q.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', token, userId, expires.toISOString());
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
}
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((c) => {
    const i = c.indexOf('=');
    return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
  }));
}
function currentUser(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  return q.get(`SELECT u.id, u.email, u.username, u.name, u.avatar, u.xp
                FROM sessions s JOIN users u ON u.id = s.user_id
                WHERE s.token = ? AND s.expires_at > ?`, sid, new Date().toISOString()) || null;
}
const publicUser = (u) => u && ({ id: u.id, name: u.name, username: u.username, email: u.email, avatar: u.avatar, xp: u.xp, ...levelOf(u.xp) });

/* -------------------------------------------------------- HTTP-утилиты */
function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(new HttpError(413, 'Слишком большой запрос')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Некорректный JSON')); }
    });
    req.on('error', reject);
  });
}
const str = (v, max = 1000) => String(v ?? '').trim().slice(0, max);
const requireUser = (user) => user || fail(401, 'Нужно войти в аккаунт');

/* ------------------------------------------------------------- API */
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler });
};

// --- Авторизация
route('POST', '/api/register', async ({ body, res }) => {
  const email = str(body.email, 120).toLowerCase();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Введите корректную почту');
  if (password.length < 6) fail(400, 'Пароль должен быть не короче 6 символов');
  if (password !== String(body.password2 || '')) fail(400, 'Пароли не совпадают');
  if (q.get('SELECT 1 FROM users WHERE email = ?', email)) fail(409, 'Пользователь с такой почтой уже есть');

  // @имя делаем из почты, при совпадении добавляем цифры
  const base = (email.split('@')[0].replace(/[^a-z0-9_]/gi, '').toLowerCase() || 'user').slice(0, 30);
  let username = base, n = 1;
  while (q.get('SELECT 1 FROM users WHERE username = ?', username)) username = base + (++n);

  const { salt, hash } = hashPassword(password);
  const r = q.run('INSERT INTO users (email, username, name, password_hash, salt) VALUES (?, ?, ?, ?, ?)',
    email, username, base, hash, salt);
  createSession(res, Number(r.lastInsertRowid));
  return { ok: true };
});

route('POST', '/api/login', async ({ body, res }) => {
  const login = str(body.login, 120).toLowerCase().replace(/^@/, '');
  const u = q.get('SELECT * FROM users WHERE email = ? OR username = ?', login, login);
  if (!u || !checkPassword(String(body.password || ''), u.salt, u.password_hash)) fail(401, 'Неверный логин или пароль');
  createSession(res, u.id);
  return { ok: true };
});

route('POST', '/api/logout', async ({ req, res }) => {
  const sid = parseCookies(req).sid;
  if (sid) q.run('DELETE FROM sessions WHERE token = ?', sid);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return { ok: true };
});

route('GET', '/api/me', async ({ user }) => ({ user: publicUser(user) }));

route('PUT', '/api/me', async ({ user, body }) => {
  requireUser(user);
  const name = str(body.name, 60);
  const username = str(body.username, 40).replace(/^@/, '').toLowerCase();
  if (!name) fail(400, 'Имя не может быть пустым');
  if (!/^[a-z0-9_]{3,30}$/.test(username)) fail(400, '@имя: 3–30 символов, латиница, цифры и _');
  if (q.get('SELECT 1 FROM users WHERE username = ? AND id <> ?', username, user.id)) fail(409, 'Такое @имя уже занято');
  q.run('UPDATE users SET name = ?, username = ? WHERE id = ?', name, username, user.id);
  return { user: publicUser(q.get('SELECT * FROM users WHERE id = ?', user.id)) };
});

// --- Профиль
route('GET', '/api/profile', async ({ user }) => {
  requireUser(user);
  const cards = q.all(`SELECT c.id, c.name, c.image, c.rarity, COUNT(*) AS count, MIN(uc.obtained_at) AS first_at
                       FROM user_cards uc JOIN cards c ON c.id = uc.card_id
                       WHERE uc.user_id = ? GROUP BY c.id ORDER BY first_at`, user.id);
  const totalCards = q.get('SELECT COUNT(*) AS n FROM cards').n;
  const viewed = q.all(`SELECT f.*, v.viewed_at FROM film_views v JOIN films f ON f.id = v.film_id
                        WHERE v.user_id = ? ORDER BY v.viewed_at DESC, f.sort_order`, user.id);
  return { user: publicUser(user), cards, totalCards, viewed };
});

// --- Мультфильмы
route('GET', '/api/films', async () => ({ films: q.all('SELECT * FROM films ORDER BY sort_order') }));

route('GET', '/api/films/:id', async ({ params, user }) => {
  const film = q.get('SELECT * FROM films WHERE id = ?', Number(params.id)) || fail(404, 'Мультфильм не найден');
  const reviews = q.all('SELECT id, author_name, text, created_at FROM reviews WHERE film_id = ? ORDER BY created_at DESC', film.id);
  const others = q.all('SELECT id, title, poster, status FROM films WHERE id <> ? ORDER BY sort_order', film.id);
  const viewed = user ? !!q.get('SELECT 1 FROM film_views WHERE user_id = ? AND film_id = ?', user.id, film.id) : false;
  return { film, reviews, others, viewed };
});

route('POST', '/api/films/:id/view', async ({ params, user }) => {
  if (!user) return { ok: true, saved: false };
  const film = q.get('SELECT id FROM films WHERE id = ?', Number(params.id)) || fail(404, 'Мультфильм не найден');
  const r = q.run('INSERT OR IGNORE INTO film_views (user_id, film_id) VALUES (?, ?)', user.id, film.id);
  if (r.changes) addXp(user.id, XP.view);
  return { ok: true, saved: true, xpGained: r.changes ? XP.view : 0 };
});

// --- Рецензии (форма «Рецензия / Поделиться...» в подвале и на странице мультфильма)
route('GET', '/api/reviews', async () => ({
  reviews: q.all(`SELECT r.id, r.author_name, r.text, r.created_at, f.title AS film_title
                  FROM reviews r LEFT JOIN films f ON f.id = r.film_id ORDER BY r.created_at DESC LIMIT 20`),
}));

route('POST', '/api/reviews', async ({ body, user }) => {
  const text = str(body.text, 1000);
  if (text.length < 3) fail(400, 'Напишите хотя бы пару слов');
  let filmId = body.film_id ? Number(body.film_id) : null;
  if (filmId && !q.get('SELECT 1 FROM films WHERE id = ?', filmId)) filmId = null;
  const author = user ? user.name : (str(body.author_name, 60) || 'Гость');
  const r = q.run('INSERT INTO reviews (film_id, user_id, author_name, text) VALUES (?, ?, ?, ?)', filmId, user ? user.id : null, author, text);
  if (user) addXp(user.id, XP.review);
  return { ok: true, review: q.get('SELECT id, author_name, text, created_at FROM reviews WHERE id = ?', Number(r.lastInsertRowid)) };
});

// --- Новости
route('GET', '/api/news', async () => ({ news: q.all('SELECT * FROM news ORDER BY published_at DESC') }));

// --- Ивенты и карточная игра «Волнение»
function spinsLeft(userId, ev) {
  const today = new Date().toISOString().slice(0, 10);
  const used = q.get(`SELECT COUNT(*) AS n FROM user_cards uc JOIN cards c ON c.id = uc.card_id
                      WHERE uc.user_id = ? AND c.event_id = ? AND substr(uc.obtained_at, 1, 10) = ?`, userId, ev.id, today).n;
  return Math.max(0, ev.spins_per_day - used);
}

route('GET', '/api/events', async ({ user }) => {
  const events = q.all('SELECT * FROM events ORDER BY sort_order');
  const active = events.find((e) => e.status === 'active') || null;
  return {
    events,
    active,
    cards: active ? q.all('SELECT id, name, image, rarity FROM cards WHERE event_id = ?', active.id) : [],
    spinsLeft: user && active ? spinsLeft(user.id, active) : null,
  };
});

route('POST', '/api/events/:id/spin', async ({ params, user }) => {
  requireUser(user);
  const ev = q.get('SELECT * FROM events WHERE id = ?', Number(params.id)) || fail(404, 'Ивент не найден');
  if (ev.status !== 'active') fail(400, 'Этот ивент сейчас не проходит');
  if (spinsLeft(user.id, ev) <= 0) fail(429, 'Попытки на сегодня закончились — возвращайтесь завтра!');

  const cards = q.all('SELECT * FROM cards WHERE event_id = ?', ev.id);
  let roll = crypto.randomInt(cards.reduce((s, c) => s + c.weight, 0));
  const card = cards.find((c) => (roll -= c.weight) < 0);

  const isNewCard = !q.get('SELECT 1 FROM user_cards WHERE user_id = ? AND card_id = ?', user.id, card.id);
  // obtained_at в формате ISO (UTC), чтобы подсчёт попыток за день был корректным
  q.run('INSERT INTO user_cards (user_id, card_id, obtained_at) VALUES (?, ?, ?)', user.id, card.id, new Date().toISOString());
  const gained = XP.spin + (isNewCard ? XP.newCard : 0);
  addXp(user.id, gained);
  return { card: { id: card.id, name: card.name, image: card.image, rarity: card.rarity }, isNew: isNewCard, xpGained: gained, spinsLeft: spinsLeft(user.id, ev) };
});

// --- Кассовый сбор
const fundState = () => {
  const f = q.get('SELECT * FROM fundraising WHERE id = 1');
  const s = q.get('SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt FROM donations');
  return { title: f.title, goal: f.goal_amount, collected: s.total, donors: s.cnt };
};
route('GET', '/api/fund', async () => fundState());
route('POST', '/api/fund/donate', async ({ body, user }) => {
  const amount = Math.floor(Number(body.amount));
  if (!Number.isFinite(amount) || amount < 10 || amount > 1_000_000) fail(400, 'Сумма — от 10 до 1 000 000 ₽');
  q.run('INSERT INTO donations (user_id, amount, comment) VALUES (?, ?, ?)', user ? user.id : null, amount, str(body.comment, 200) || null);
  if (user) addXp(user.id, Math.min(50, Math.floor(amount / 100)));
  return fundState();
});

/* -------------------------------------------------- Статические файлы */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.json': 'application/json', '.mp4': 'video/mp4',
};
// «Красивые» адреса страниц
const PAGES = { '/': 'index.html', '/film': 'film.html', '/profile': 'profile.html', '/events': 'events.html', '/login': 'index.html', '/register': 'index.html' };

function serveFile(res, file, status = 200) {
  fs.readFile(file, (err, data) => {
    if (err) return serve404(res);
    res.writeHead(status, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}
const serve404 = (res) => fs.readFile(path.join(PUBLIC, '404.html'), (e, d) => {
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(e ? 'Страница не найдена' : d);
});

/* ------------------------------------------------------------ Сервер */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/api/')) {
    const r = routes.find((x) => x.method === req.method && x.re.test(pathname));
    if (!r) return send(res, 404, { error: 'Метод API не найден' });
    try {
      const m = pathname.match(r.re);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
      const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
      const data = await r.handler({ req, res, params, body, query: url.searchParams, user: currentUser(req) });
      return send(res, 200, data);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      return send(res, 500, { error: 'Ошибка сервера' });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return serve404(res);
  if (PAGES[pathname]) return serveFile(res, path.join(PUBLIC, PAGES[pathname]));

  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC + path.sep)) return serve404(res);   // защита от ../
  fs.stat(file, (err, st) => (err || !st.isFile() ? serve404(res) : serveFile(res, file)));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Порт ${PORT} занят другим процессом. Откройте http://localhost:${PORT} или завершите старый сервер.`);
  } else {
    console.error('Не удалось запустить сервер:', err.message);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`«Волнуй» запущен: http://localhost:${PORT}`);
});
