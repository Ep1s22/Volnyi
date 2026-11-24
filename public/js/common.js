/* =====================================================================
   Общий JS для всех страниц: шапка, меню, подвал, API, уведомления.
   ===================================================================== */

/** Запрос к API сервера. Бросает Error с текстом ошибки из БД/сервера. */
async function api(url, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new Error('Нет соединения с сервером. Проверьте интернет и попробуйте ещё раз.');
  }
  let data = {};
  try { data = await res.json(); } catch { /* пустой ответ */ }
  if (!res.ok) { const e = new Error(data.error || 'Ошибка соединения'); e.status = res.status; throw e; }
  return data;
}

/** Экранирование текста перед вставкой в HTML. */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const rub = (n) => new Intl.NumberFormat('ru-RU').format(n) + ' ₽';

/** Всплывающее уведомление. */
function toast(text, isError = false) {
  let el = $('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.textContent = text;
  el.classList.toggle('is-error', isError);
  el.classList.add('is-visible');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('is-visible'), 3200);
}

/** Модальное окно: openModal(html) → возвращает элемент .modal */
function openModal(html) {
  const opener = document.activeElement;           // вернём фокус сюда после закрытия
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="modal__box" role="dialog" aria-modal="true" tabindex="-1"><button class="modal__close" aria-label="Закрыть">×</button>${html}</div>`;
  const box = m.firstElementChild;
  const lock = () => document.body.classList.toggle('has-modal', $$('.modal').some((x) => !x._closed));
  const isTop = () => $$('.modal').filter((x) => !x._closed).pop() === m;
  const focusables = () => $$('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), video[controls]', box)
    .filter((el) => el.offsetParent !== null);

  const close = () => {
    if (m._closed) return;
    m._closed = true;
    m.classList.remove('is-open');
    setTimeout(() => m.remove(), 250);
    document.removeEventListener('keydown', onKey);
    lock();
    if (opener && opener.isConnected && opener.focus) opener.focus({ preventScroll: true });
  };
  const onKey = (e) => {
    if (!isTop()) return;
    if (e.key === 'Escape') return close();
    if (e.key !== 'Tab') return;
    // фокус не уходит за пределы окна
    const f = focusables();
    if (!f.length) { e.preventDefault(); box.focus(); return; }
    const first = f[0], last = f[f.length - 1], cur = document.activeElement;
    if (e.shiftKey && (cur === first || cur === box)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
  };
  m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('.modal__close')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(m);
  lock();
  requestAnimationFrame(() => {
    m.classList.add('is-open');
    // фокус можно ставить только на видимый элемент, поэтому — когда окно уже начало появляться
    setTimeout(() => {
      if (!m._closed) (focusables().find((el) => el.matches('input, textarea')) || box).focus({ preventScroll: true });
    }, 60);
  });
  m.close = close;
  return m;
}

/* Если постер или карточка не загрузились — показываем заглушку, а не «битую» картинку */
const IMG_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 420"><rect width="300" height="420" rx="24" fill="#bec9df"/>' +
  '<circle cx="215" cy="110" r="34" fill="#fefef5" opacity=".85"/>' +
  '<path d="M0 300c50-30 100 30 150 0s100-30 150 0v120H0z" fill="#5370ab" opacity=".6"/>' +
  '<path d="M0 345c50-30 100 30 150 0s100-30 150 0v75H0z" fill="#284d98" opacity=".75"/></svg>');
function fixBrokenImage(img) {
  if (img.tagName !== 'IMG' || img.dataset.fallback) return;
  if (!/\/img\/(posters|cards)\//.test(img.getAttribute('src') || '')) return;
  img.dataset.fallback = '1';
  img.src = IMG_PLACEHOLDER;
}
document.addEventListener('error', (e) => fixBrokenImage(e.target), true);
addEventListener('load', () => $$('img').forEach((img) => img.complete && !img.naturalWidth && fixBrokenImage(img)));

/* ------------------------------------------------ Текущий пользователь */
const Auth = {
  user: null,
  ready: api('/api/me').then((d) => {
    if (!Auth.user) Auth.user = d.user;
    return Auth.user;
  }).catch(() => null),
  async logout() {
    await api('/api/logout', { method: 'POST' });
    location.href = '/';
  },
};

function updateAuthLinks(user) {
  const link = $('[data-auth-link]');
  const menuLink = $('[data-auth-menu]');
  if (!link || !menuLink) return;
  if (user) {
    link.textContent = user.name; link.href = '/profile'; link.title = 'Профиль';
    menuLink.textContent = 'Выход'; menuLink.href = '#';
  } else {
    link.textContent = 'Вход'; link.href = '/login'; link.removeAttribute('title');
    menuLink.textContent = 'Вход'; menuLink.href = '/login';
  }
}

function authFormMarkup(mode) {
  const isRegister = mode === 'register';
  return `<div class="auth auth-modal">
    <form class="auth__panel" data-mode="${mode}" novalidate>
      <div class="auth__card">
        <h2 class="sr-only">${isRegister ? 'Регистрация' : 'Вход'}</h2>
        <div class="auth__tabs" role="tablist" aria-label="Вход или регистрация">
          <button type="button" data-auth-mode="login" role="tab" aria-selected="${!isRegister}" class="${isRegister ? '' : 'is-active'}">Вход</button>
          <b>/</b>
          <button type="button" data-auth-mode="register" role="tab" aria-selected="${isRegister}" class="${isRegister ? 'is-active' : ''}">Регистрация</button>
        </div>
        ${isRegister ? `
          <label class="field"><input name="email" type="email" autocomplete="email" required><span>Почта</span></label>
          <label class="field"><input name="password" type="password" autocomplete="new-password" minlength="6" required><span>Пароль</span></label>
          <label class="field"><input name="password2" type="password" autocomplete="new-password" required><span>Повторите пароль</span></label>` : `
          <label class="field"><input name="login" autocomplete="username" required><span>Логин</span></label>
          <label class="field"><input name="password" type="password" autocomplete="current-password" required><span>Пароль</span></label>
          <p class="auth__demo">Логин — почта или @имя. Демо: demo@volnuy.ru / demo123</p>`}
        <p class="auth__error" role="alert"></p>
      </div>
      <button class="auth__submit" type="submit">${isRegister ? 'Зарегистрироваться' : 'Войти'}</button>
    </form>
  </div>`;
}

function openAuthModal(mode = 'login', redirectTo = null) {
  const modal = openModal('<div class="auth-modal__content"></div>');
  const box = $('.modal__box', modal);
  box.classList.add('auth-modal__box');
  const content = $('.auth-modal__content', modal);

  const render = (nextMode) => {
    content.innerHTML = authFormMarkup(nextMode);
    const form = $('.auth__panel', content);
    const errorEl = $('.auth__error', form);
    $('input', form)?.focus({ preventScroll: true });
    form.addEventListener('input', () => { errorEl.textContent = ''; });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      if (nextMode === 'register') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) { errorEl.textContent = 'Введите корректную почту'; return; }
        if (values.password.length < 6) { errorEl.textContent = 'Пароль — минимум 6 символов'; return; }
        if (values.password !== values.password2) { errorEl.textContent = 'Пароли не совпадают'; return; }
      } else if (!values.login || !values.password) {
        errorEl.textContent = 'Заполните логин и пароль';
        return;
      }

      const submit = $('.auth__submit', form);
      submit.disabled = true;
      try {
        await api(nextMode === 'register' ? '/api/register' : '/api/login', { method: 'POST', body: values });
        const { user } = await api('/api/me');
        Auth.user = user;
        updateAuthLinks(user);
        document.dispatchEvent(new CustomEvent('auth:changed', { detail: user }));
        modal.close();
        if (redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//')) location.href = redirectTo;
      } catch (error) {
        errorEl.textContent = error.message;
        form.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 300 });
      } finally {
        submit.disabled = false;
      }
    });
  };

  content.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-auth-mode]');
    if (tab) render(tab.dataset.authMode);
  });
  render(mode);
  return modal;
}

/* ------------------------------------------------ Шапка, меню, подвал */
const SOCIALS = `
  <a href="https://vk.ru/qwarghosskskst" target="_blank" rel="noopener" aria-label="ВКонтакте"><img src="/img/ic-vk.svg" alt=""></a>
  <a href="https://www.instagram.com/linao.ok?knvt=NGR0bmR6aWcyczFu" target="_blank" rel="noopener" aria-label="Instagram"><img src="/img/ic-inst.svg" alt=""></a>
  <a href="https://t.me/balkwhuqos" target="_blank" rel="noopener" aria-label="Telegram"><img src="/img/ic-tg.svg" alt=""></a>`;

function renderChrome() {
  const here = location.pathname.replace(/\.html$/, '').replace(/\/index$/, '/') || '/';
  const nav = [['/', 'Главная'], ['/profile', 'Профиль'], ['/film', 'Плеер'], ['/events', 'Ивенты'], ['/login', 'Вход', 'auth']];

  const header = $('#site-header');
  if (header) header.outerHTML = `
    <header class="header">
      <a class="header__logo" href="/" aria-label="На главную"><img src="/img/logo-icon.svg" alt="Волнуй"></a>
      <nav class="header__desktop-nav" aria-label="Основная навигация">
        ${nav.filter(([href]) => href === '/film' || href === '/events').map(([href, label]) => `
          <a href="${href}" class="${here === href ? 'is-active' : ''}">${label}</a>`).join('')}
      </nav>
      <div class="header__right">
        <a class="header__login" href="/login" data-auth-link>Вход</a>
        <button class="burger" aria-label="Открыть меню" aria-expanded="false"><img src="/img/burger.svg" alt=""></button>
      </div>
    </header>
    <div class="menu-overlay"></div>
    <aside class="menu" aria-label="Меню">
      <div class="menu__top"><button class="burger" aria-label="Закрыть меню"><img src="/img/burger.svg" alt=""></button></div>
      <nav class="menu__nav">
        ${nav.map(([href, label, flag]) => `<a href="${href}" ${flag ? 'data-auth-menu' : ''} class="${here === href ? 'is-active' : ''}">${label}</a>`).join('')}
      </nav>
      <div class="menu__bottom">
        Соц. сети
        <div class="socials">${SOCIALS}</div>
        Тех. поддержка
        <small><a href="tel:+79508767690">+7 950 876 76 90</a></small>
      </div>
    </aside>`;

  const footer = $('#site-footer');
  if (footer) footer.outerHTML = `
    <footer class="footer">
      <img class="footer__wave" src="/img/footer-top.svg" alt="">
      <div class="footer__body">
        <div class="footer__col">
          <h4>Соц. сети</h4>
          <div class="socials">${SOCIALS}</div>
          <h4>Тех. поддержка</h4>
          <p><a href="tel:+79508767690">+7 950 876 76 90</a></p>
          <h4>По всем вопросам</h4>
          <p style="margin:0"><a href="tel:+79863679819">+ 7 986 367 98 19</a></p>
        </div>
        <div class="footer__col footer__center">
          <img src="/img/seaweed.png" alt="">
          <a href="#" data-offer>Оферта/Политика конфиденциальности</a>
        </div>
        <div class="footer__col footer__review">
          <h4>Рецензия</h4>
          <form data-review-form>
            <textarea name="text" placeholder="Поделиться..." maxlength="1000" aria-label="Текст рецензии"></textarea>
            <button type="submit">Отправить</button>
          </form>
          <div class="footer__copy">2026 Студия анимации ВОЛНУЙ</div>
        </div>
      </div>
      <div class="footer__line"><hr></div>
    </footer>
    <button class="to-top" aria-label="Наверх"><svg viewBox="0 0 24 24"><path d="M5 15l7-7 7 7"/></svg></button>`;

  // меню
  const toggleMenu = (open) => {
    document.body.classList.toggle('menu-open', open);
    $$('.header .burger').forEach((b) => b.setAttribute('aria-expanded', String(open)));
  };
  $$('.burger').forEach((b) => b.addEventListener('click', () => toggleMenu(!document.body.classList.contains('menu-open'))));
  $('.menu-overlay')?.addEventListener('click', () => toggleMenu(false));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && toggleMenu(false));

  // аккуратное скрытие хедера при прокрутке вниз и возврат при прокрутке вверх
  const autoHeader = $('.header');
  let lastScrollY = scrollY;
  let scrollFrame = 0;
  const updateHeader = () => {
    scrollFrame = 0;
    const currentScrollY = Math.max(0, scrollY);
    const delta = currentScrollY - lastScrollY;
    if (!document.body.classList.contains('menu-open')) {
      if (delta > 6 && currentScrollY > 80) autoHeader?.classList.add('is-hidden');
      if (delta < -6 || currentScrollY < 80) autoHeader?.classList.remove('is-hidden');
    }
    lastScrollY = currentScrollY;
  };
  addEventListener('scroll', () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(updateHeader);
  }, { passive: true });

  // кнопка «наверх»
  const toTop = $('.to-top');
  if (toTop) {
    const upd = () => toTop.classList.toggle('is-visible', scrollY > 500);
    addEventListener('scroll', upd, { passive: true }); upd();
    toTop.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));
  }

  // оферта
  $('[data-offer]')?.addEventListener('click', (e) => {
    e.preventDefault();
    openModal(`<h3>Оферта и политика конфиденциальности</h3>
      <p>Студия анимации «Волнуй» хранит только данные, необходимые для работы аккаунта: почту, имя, хэш пароля, историю просмотров и полученные карточки.</p>
      <p>Данные не передаются третьим лицам. Пароли хранятся в зашифрованном виде (scrypt). Удалить аккаунт можно по запросу в тех. поддержку.</p>`);
  });

  // форма рецензии в подвале
  const form = $('[data-review-form]');
  if (form) {
    const ta = form.text;
    ta.addEventListener('input', () => form.classList.toggle('has-text', ta.value.trim().length > 0));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const filmId = document.body.dataset.filmId || null;
        const { review } = await api('/api/reviews', { method: 'POST', body: { text: ta.value, film_id: filmId } });
        ta.value = ''; form.classList.remove('has-text');
        toast(Auth.user ? 'Спасибо за рецензию! +15 опыта' : 'Спасибо за рецензию!');
        document.dispatchEvent(new CustomEvent('review:added', { detail: review }));
      } catch (err) { toast(err.message, true); }
    });
  }

  // состояние входа
  const link = $('[data-auth-link]');
  const menuLink = $('[data-auth-menu]');
  link?.addEventListener('click', (e) => {
    if (Auth.user) return;
    e.preventDefault();
    openAuthModal('login');
  });
  menuLink?.addEventListener('click', (e) => {
    e.preventDefault();
    if (Auth.user) return Auth.logout();
    toggleMenu(false);
    openAuthModal('login');
  });
  Auth.ready.then((user) => updateAuthLinks(Auth.user || user));
}

/* Плавное появление блоков с классом .reveal */
function initReveal() {
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
  }), { threshold: 0.12 });
  $$('.reveal').forEach((el) => io.observe(el));
}

/* Пузырьки: <div data-bubbles="x,y,size;x,y,size"> (в единицах макета) */
function initBubbles() {
  $$('[data-bubbles]').forEach((box) => {
    box.dataset.bubbles.split(';').forEach((b, i) => {
      const [x, y, s] = b.split(',').map(Number);
      const el = document.createElement('span');
      el.className = 'bubble';
      el.style.cssText = `left:calc(${x} * var(--u));top:calc(${y} * var(--u));width:calc(${s} * var(--u));height:calc(${s} * var(--u));animation-delay:${(i % 5) * -1.1}s`;
      box.append(el);
    });
  });
}

/* Анимация пузырьков есть только на страницах «Профиль» и «Ивенты» */
const BUBBLE_PAGES = /^\/(profile|events)(\.html)?\/?$/;
const bubblesAllowed = () => BUBBLE_PAGES.test(location.pathname);

/* Пузырьки по краям экрана: поднимаются снизу вверх бесконечно (только профиль и ивенты) */
function initEdgeBubbles() {
  if (!bubblesAllowed()) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'edge-bubbles';
  box.setAttribute('aria-hidden', 'true');
  const perSide = innerWidth < 761 ? 5 : 9;
  const rnd = (a, b) => a + Math.random() * (b - a);
  ['left', 'right'].forEach((side) => {
    for (let i = 0; i < perSide; i++) {
      const el = document.createElement('span');
      const dur = rnd(10, 18);
      el.className = `edge-bubble is-${side}`;
      el.style.cssText = `--x:${rnd(0.6, 4.5).toFixed(2)}vw;--s:${Math.round(rnd(8, innerWidth < 761 ? 22 : 36))}px;` +
        `--d:${dur.toFixed(1)}s;--delay:${(-dur * i / perSide - rnd(0, 1.5)).toFixed(1)}s;--sway:${Math.round(rnd(8, 26)) * (side === 'left' ? 1 : -1)}px`;
      box.append(el);
    }
  });
  document.body.append(box);
}

renderChrome();
if (location.pathname === '/login' || location.pathname === '/register') {
  const mode = location.pathname === '/register' ? 'register' : 'login';
  const redirectTo = new URLSearchParams(location.search).get('next');
  history.replaceState(null, '', '/');
  openAuthModal(mode, redirectTo);
}
document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.toggle('has-bubbles', bubblesAllowed());
  initReveal(); initBubbles(); initEdgeBubbles();
});
