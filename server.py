import hashlib
import json
import mimetypes
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
DB_DIR = Path(os.environ.get("DB_DIR", str(ROOT / "db")))
DB_DIR.mkdir(parents=True, exist_ok=True)
DB_FILE = DB_DIR / "volnuy.db"
PORT = int(os.environ.get("PORT", "8081"))

DB_FILE.parent.mkdir(parents=True, exist_ok=True)
is_new = not DB_FILE.exists()
db = sqlite3.connect(DB_FILE, check_same_thread=False)
db.row_factory = sqlite3.Row
db.execute("PRAGMA foreign_keys = ON")
db.executescript((ROOT / "db" / "schema.sql").read_text("utf-8"))
if is_new:
    db.executescript((ROOT / "db" / "seed.sql").read_text("utf-8"))
    db.commit()
    print("База данных создана и заполнена: db/volnuy.db")

for old_title, title in (
    ("Создание анимационной студии ВОЛНУЙ. Какие ценности студии?", "Волнуй"),
    ("Ожидается анонс первого мультфильма. Что ждать от новой студии?", "Буря?"),
    ("Вышел анонс первого мультфильма “Буря” от студии анимации ВОЛНУЙ", "Внутренняя буря"),
):
    db.execute("UPDATE news SET title = ? WHERE title = ?", (title, old_title))
db.execute("UPDATE news SET image = 'logo-blue.png' WHERE id = 1 AND image IN ('posters/mayak.png', 'posters/mayak.jpg')")
db.commit()

PAGES = {
    "/": "index.html",
    "/film": "film.html",
    "/profile": "profile.html",
    "/events": "events.html",
    "/login": "index.html",
    "/register": "index.html",
}

def rows(sql, params=()):
    return [dict(row) for row in db.execute(sql, params).fetchall()]

def row(sql, params=()):
    result = db.execute(sql, params).fetchone()
    return dict(result) if result else None

def execute(sql, params=()):
    cursor = db.execute(sql, params)
    db.commit()
    return cursor

def scrypt(password, salt):
    return hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt.encode("utf-8"),
        n=16384,
        r=8,
        p=1,
        dklen=64,
    ).hex()

def public_user(user):
    if not user:
        return None
    xp = user["xp"]
    result = dict(user)
    result.update({"level": xp // 100 + 1, "progress": xp % 100, "need": 100})
    for key in ("password_hash", "salt", "created_at"):
        result.pop(key, None)
    return result

def current_user(cookies):
    sid = cookies.get("sid")
    if not sid:
        return None
    return row(
        """SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
           WHERE s.token=? AND s.expires_at>?""",
        (sid, datetime.now(timezone.utc).isoformat()),
    )

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def cookies(self):
        result = {}
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        for key, morsel in cookie.items():
            result[key] = morsel.value
        return result

    def send_json(self, status, data, headers=None):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > 1000000:
            raise ValueError("request too large")
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def send_video(self, file, mime):
        """Видео отдаём частями (HTTP Range) — иначе в браузере не работает перемотка."""
        size = file.stat().st_size
        start, end, code = 0, size - 1, 200
        rng = self.headers.get("Range", "")
        if rng.startswith("bytes=") and "," not in rng:
            a, _, b = rng[6:].partition("-")
            try:
                if a == "" and b != "":
                    start = max(0, size - int(b))
                else:
                    start = int(a or 0)
                    if b != "":
                        end = min(int(b), size - 1)
            except ValueError:
                start, end = 0, size - 1
            if start > end or start >= size:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            code = 206
        self.send_response(code)
        self.send_header("Content-Type", mime)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if code == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if self.command == "HEAD":
            return
        try:
            with open(file, "rb") as f:
                f.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = f.read(min(256 * 1024, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # браузер сам обрывает запрос при перемотке — это нормально

    def send_file(self, file, status=200):
        mime = mimetypes.guess_type(str(file))[0] or "application/octet-stream"
        if file.suffix.lower() == ".mp4":
            mime = "video/mp4"
        if mime.startswith("video/") and file.is_file():
            self.send_video(file, mime)
            return
        try:
            body = file.read_bytes()
        except OSError:
            self.send_error_file()
            return
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_error_file(self):
        file = PUBLIC / "404.html"
        body = file.read_bytes() if file.exists() else b"Page not found"
        self.send_response(404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path.startswith("/api/"):
            self.handle_api("GET", path)
            return
        if path in PAGES:
            self.send_file(PUBLIC / PAGES[path])
            return
        file = (PUBLIC / path.lstrip("/")).resolve()
        if PUBLIC.resolve() in file.parents and file.is_file():
            self.send_file(file)
        else:
            self.send_error_file()

    def do_POST(self):
        parsed = urlparse(self.path)
        self.handle_api("POST", unquote(parsed.path))

    def do_PUT(self):
        parsed = urlparse(self.path)
        self.handle_api("PUT", unquote(parsed.path))

    def handle_api(self, method, path):
        try:
            body = self.read_body() if method in ("POST", "PUT") else {}
            user = current_user(self.cookies())

            if method == "POST" and path == "/api/register":
                email = str(body.get("email", "")).strip().lower()[:120]
                password = str(body.get("password", ""))
                if "@" not in email or "." not in email:
                    return self.send_json(400, {"error": "Введите корректную почту"})
                if len(password) < 6:
                    return self.send_json(400, {"error": "Пароль должен быть не короче 6 символов"})
                if password != str(body.get("password2", "")):
                    return self.send_json(400, {"error": "Пароли не совпадают"})
                if row("SELECT 1 FROM users WHERE email=?", (email,)):
                    return self.send_json(409, {"error": "Пользователь с такой почтой уже есть"})
                base = "".join(c for c in email.split("@")[0].lower() if c.isalnum() or c == "_")[:30] or "user"
                username = base
                number = 1
                while row("SELECT 1 FROM users WHERE username=?", (username,)):
                    number += 1
                    username = base + str(number)
                salt = secrets.token_hex(16)
                password_hash = scrypt(password, salt)
                cursor = execute(
                    "INSERT INTO users (email,username,name,password_hash,salt) VALUES (?,?,?,?,?)",
                    (email, username, base, password_hash, salt),
                )
                return self.create_session(cursor.lastrowid, {"ok": True})

            if method == "POST" and path == "/api/login":
                login = str(body.get("login", "")).strip().lower().lstrip("@")[:120]
                found = row("SELECT * FROM users WHERE email=? OR username=?", (login, login))
                if not found or not secrets.compare_digest(scrypt(str(body.get("password", "")), found["salt"]), found["password_hash"]):
                    return self.send_json(401, {"error": "Неверный логин или пароль"})
                return self.create_session(found["id"], {"ok": True})

            if method == "POST" and path == "/api/logout":
                sid = self.cookies().get("sid")
                if sid:
                    execute("DELETE FROM sessions WHERE token=?", (sid,))
                return self.send_json(200, {"ok": True}, {"Set-Cookie": "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"})

            if method == "GET" and path == "/api/me":
                return self.send_json(200, {"user": public_user(user)})

            if method == "PUT" and path == "/api/me":
                if not user:
                    return self.send_json(401, {"error": "Нужно войти в аккаунт"})
                name = str(body.get("name", "")).strip()[:60]
                username = str(body.get("username", "")).strip().lstrip("@").lower()[:40]
                if not name:
                    return self.send_json(400, {"error": "Имя не может быть пустым"})
                if len(username) < 3 or len(username) > 30 or not all(c.isalnum() or c == "_" for c in username):
                    return self.send_json(400, {"error": "@имя: 3–30 символов, латиница, цифры и _"})
                if row("SELECT 1 FROM users WHERE username=? AND id<>?", (username, user["id"])):
                    return self.send_json(409, {"error": "Такое @имя уже занято"})
                execute("UPDATE users SET name=?,username=? WHERE id=?", (name, username, user["id"]))
                return self.send_json(200, {"user": public_user(row("SELECT * FROM users WHERE id=?", (user["id"],)))})

            if method == "GET" and path == "/api/profile":
                if not user:
                    return self.send_json(401, {"error": "Нужно войти в аккаунт"})
                cards = rows("""SELECT c.id,c.name,c.image,c.rarity,COUNT(*) AS count,
                                       MIN(uc.obtained_at) AS first_at
                                FROM user_cards uc JOIN cards c ON c.id=uc.card_id
                                WHERE uc.user_id=? GROUP BY c.id ORDER BY first_at""", (user["id"],))
                total = row("SELECT COUNT(*) AS n FROM cards")["n"]
                viewed = rows("""SELECT f.*,v.viewed_at FROM film_views v JOIN films f ON f.id=v.film_id
                                 WHERE v.user_id=? ORDER BY v.viewed_at DESC,f.sort_order""", (user["id"],))
                return self.send_json(200, {"user": public_user(user), "cards": cards, "totalCards": total, "viewed": viewed})

            if method == "GET" and path == "/api/films":
                return self.send_json(200, {"films": rows("SELECT * FROM films ORDER BY sort_order")})

            if method == "GET" and path.startswith("/api/films/") and path.count("/") == 3:
                film_id = path.rsplit("/", 1)[1]
                film = row("SELECT * FROM films WHERE id=?", (int(film_id),))
                if not film:
                    return self.send_json(404, {"error": "Мультфильм не найден"})
                reviews = rows("SELECT id,author_name,text,created_at FROM reviews WHERE film_id=? ORDER BY created_at DESC", (film["id"],))
                others = rows("SELECT id,title,poster,status FROM films WHERE id<>? ORDER BY sort_order", (film["id"],))
                viewed = bool(user and row("SELECT 1 FROM film_views WHERE user_id=? AND film_id=?", (user["id"], film["id"])))
                return self.send_json(200, {"film": film, "reviews": reviews, "others": others, "viewed": viewed})

            if method == "POST" and path.startswith("/api/films/") and path.endswith("/view"):
                film_id = int(path.split("/")[3])
                if not user:
                    return self.send_json(200, {"ok": True, "saved": False})
                if not row("SELECT id FROM films WHERE id=?", (film_id,)):
                    return self.send_json(404, {"error": "Мультфильм не найден"})
                cursor = execute("INSERT OR IGNORE INTO film_views (user_id,film_id) VALUES (?,?)", (user["id"], film_id))
                gained = 10 if cursor.rowcount else 0
                if gained:
                    execute("UPDATE users SET xp=xp+10 WHERE id=?", (user["id"],))
                return self.send_json(200, {"ok": True, "saved": True, "xpGained": gained})

            if method == "GET" and path == "/api/reviews":
                reviews = rows("""SELECT r.id,r.author_name,r.text,r.created_at,f.title AS film_title
                                  FROM reviews r LEFT JOIN films f ON f.id=r.film_id
                                  ORDER BY r.created_at DESC LIMIT 20""")
                return self.send_json(200, {"reviews": reviews})

            if method == "POST" and path == "/api/reviews":
                text = str(body.get("text", "")).strip()[:1000]
                if len(text) < 3:
                    return self.send_json(400, {"error": "Напишите хотя бы пару слов"})
                film_id = body.get("film_id")
                film_id = int(film_id) if film_id and row("SELECT 1 FROM films WHERE id=?", (int(film_id),)) else None
                author = user["name"] if user else str(body.get("author_name", "")).strip()[:60] or "Гость"
                cursor = execute("INSERT INTO reviews (film_id,user_id,author_name,text) VALUES (?,?,?,?)",
                                 (film_id, user["id"] if user else None, author, text))
                if user:
                    execute("UPDATE users SET xp=xp+15 WHERE id=?", (user["id"],))
                return self.send_json(200, {"ok": True, "review": row("SELECT id,author_name,text,created_at FROM reviews WHERE id=?", (cursor.lastrowid,))})

            if method == "GET" and path == "/api/news":
                return self.send_json(200, {"news": rows("SELECT * FROM news ORDER BY published_at DESC")})

            if method == "GET" and path == "/api/events":
                events = rows("SELECT * FROM events ORDER BY sort_order")
                active = next((event for event in events if event["status"] == "active"), None)
                cards = rows("SELECT id,name,image,rarity FROM cards WHERE event_id=?", (active["id"],)) if active else []
                spins = self.spins_left(user["id"], active) if user and active else None
                return self.send_json(200, {"events": events, "active": active, "cards": cards, "spinsLeft": spins})

            if method == "POST" and path.startswith("/api/events/") and path.endswith("/spin"):
                if not user:
                    return self.send_json(401, {"error": "Нужно войти в аккаунт"})
                event_id = int(path.split("/")[3])
                event = row("SELECT * FROM events WHERE id=?", (event_id,))
                if not event:
                    return self.send_json(404, {"error": "Ивент не найден"})
                if event["status"] != "active":
                    return self.send_json(400, {"error": "Этот ивент сейчас не проходит"})
                if self.spins_left(user["id"], event) <= 0:
                    return self.send_json(429, {"error": "Попытки на сегодня закончились — возвращайтесь завтра!"})
                cards = rows("SELECT * FROM cards WHERE event_id=?", (event_id,))
                roll = secrets.randbelow(sum(card["weight"] for card in cards))
                chosen = None
                for card in cards:
                    roll -= card["weight"]
                    if roll < 0:
                        chosen = card
                        break
                is_new_card = not row("SELECT 1 FROM user_cards WHERE user_id=? AND card_id=?", (user["id"], chosen["id"]))
                execute("INSERT INTO user_cards (user_id,card_id,obtained_at) VALUES (?,?,?)",
                        (user["id"], chosen["id"], datetime.now(timezone.utc).isoformat()))
                gained = 5 + (20 if is_new_card else 0)
                execute("UPDATE users SET xp=xp+? WHERE id=?", (gained, user["id"]))
                return self.send_json(200, {"card": {key: chosen[key] for key in ("id", "name", "image", "rarity")},
                                             "isNew": is_new_card, "xpGained": gained,
                                             "spinsLeft": self.spins_left(user["id"], event)})

            if method == "GET" and path == "/api/fund":
                return self.send_json(200, self.fund_state())

            if method == "POST" and path == "/api/fund/donate":
                amount = int(body.get("amount", 0))
                if amount < 10 or amount > 1000000:
                    return self.send_json(400, {"error": "Сумма — от 10 до 1 000 000 ₽"})
                execute("INSERT INTO donations (user_id,amount,comment) VALUES (?,?,?)",
                        (user["id"] if user else None, amount, str(body.get("comment", ""))[:200] or None))
                if user:
                    execute("UPDATE users SET xp=xp+? WHERE id=?", (min(50, amount // 100), user["id"]))
                return self.send_json(200, self.fund_state())

            return self.send_json(404, {"error": "Метод API не найден"})
        except Exception as error:
            print(error)
            self.send_json(500, {"error": "Ошибка сервера"})

    def create_session(self, user_id, data):
        token = secrets.token_hex(32)
        expires = datetime.now(timezone.utc) + timedelta(days=30)
        execute("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)", (token, user_id, expires.isoformat()))
        return self.send_json(200, data, {"Set-Cookie": f"sid={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={30*86400}"})

    def spins_left(self, user_id, event):
        today = datetime.now(timezone.utc).date().isoformat()
        used = row("""SELECT COUNT(*) AS n FROM user_cards uc JOIN cards c ON c.id=uc.card_id
                      WHERE uc.user_id=? AND c.event_id=? AND substr(uc.obtained_at,1,10)=?""",
                   (user_id, event["id"], today))["n"]
        return max(0, event["spins_per_day"] - used)

    def fund_state(self):
        fund = row("SELECT * FROM fundraising WHERE id=1")
        total = row("SELECT COALESCE(SUM(amount),0) AS total,COUNT(*) AS cnt FROM donations")
        return {"title": fund["title"], "goal": fund["goal_amount"], "collected": total["total"], "donors": total["cnt"]}

server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
print(f"«Волнуй» запущен: http://localhost:{PORT}")
server.serve_forever()
