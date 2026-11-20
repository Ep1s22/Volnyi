-- =============================================================
--  БД сайта «Волнуй» — студия анимации
--  СУБД: SQLite 3 (встроена в Node.js >= 22.13, модуль node:sqlite)
--  Синтаксис максимально близок к стандартному SQL — схему легко
--  перенести в MySQL / PostgreSQL (см. README.md).
-- =============================================================

PRAGMA foreign_keys = ON;

-- Пользователи --------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         VARCHAR(120) NOT NULL UNIQUE,
    username      VARCHAR(40)  NOT NULL UNIQUE,      -- @имя
    name          VARCHAR(60)  NOT NULL,             -- отображаемое имя
    password_hash VARCHAR(128) NOT NULL,             -- scrypt
    salt          VARCHAR(32)  NOT NULL,
    avatar        VARCHAR(40)  NOT NULL DEFAULT 'avatar.svg',
    xp            INTEGER      NOT NULL DEFAULT 0,   -- опыт (уровень = xp / 100 + 1)
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Сессии (cookie "sid") ----------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    token      VARCHAR(64) PRIMARY KEY,
    user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at DATETIME    NOT NULL
);

-- Мультфильмы ---------------------------------------------------
CREATE TABLE IF NOT EXISTS films (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       VARCHAR(100) NOT NULL,
    genres      VARCHAR(100) NOT NULL,          -- «Комедия / Мультфильм»
    year        INTEGER      NOT NULL,
    country     VARCHAR(50)  NOT NULL,
    author      VARCHAR(100) NOT NULL,
    short_desc  VARCHAR(300) NOT NULL,
    full_desc   TEXT         NOT NULL,
    poster      VARCHAR(100) NOT NULL,          -- файл в /img/posters/
    video_url   VARCHAR(255),                   -- NULL = видео ещё не вышло
    status      VARCHAR(10)  NOT NULL DEFAULT 'soon' CHECK (status IN ('released', 'soon')),
    sort_order  INTEGER      NOT NULL DEFAULT 0
);

-- Просмотры (раздел «Просмотрено» в профиле) ---------------------
CREATE TABLE IF NOT EXISTS film_views (
    user_id   INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    film_id   INTEGER  NOT NULL REFERENCES films(id) ON DELETE CASCADE,
    viewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, film_id)
);

-- Рецензии (к мультфильму или к студии в целом, если film_id IS NULL)
CREATE TABLE IF NOT EXISTS reviews (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    film_id     INTEGER REFERENCES films(id) ON DELETE CASCADE,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_name VARCHAR(60)  NOT NULL,
    text        VARCHAR(1000) NOT NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Новости -------------------------------------------------------
CREATE TABLE IF NOT EXISTS news (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        VARCHAR(200) NOT NULL,
    body         TEXT         NOT NULL,
    image        VARCHAR(100) NOT NULL,
    published_at DATE         NOT NULL
);

-- Ивенты (карточная игра «Волнение» и будущие) -------------------
CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       VARCHAR(100) NOT NULL,
    subtitle    VARCHAR(200) NOT NULL,
    status      VARCHAR(10)  NOT NULL CHECK (status IN ('active', 'soon', 'finished')),
    spins_per_day INTEGER    NOT NULL DEFAULT 3,
    sort_order  INTEGER      NOT NULL DEFAULT 0
);

-- Карточки, которые можно выиграть в ивенте -----------------------
CREATE TABLE IF NOT EXISTS cards (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER     NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name     VARCHAR(60) NOT NULL,
    image    VARCHAR(100) NOT NULL,
    rarity   VARCHAR(12) NOT NULL CHECK (rarity IN ('common', 'rare', 'legendary')),
    weight   INTEGER     NOT NULL DEFAULT 10      -- шанс выпадения (относительный)
);

-- Полученные карточки -------------------------------------------
CREATE TABLE IF NOT EXISTS user_cards (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id     INTEGER  NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    obtained_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Кассовый сбор -------------------------------------------------
CREATE TABLE IF NOT EXISTS fundraising (
    id          INTEGER PRIMARY KEY,
    title       VARCHAR(100) NOT NULL,
    goal_amount INTEGER      NOT NULL
);

CREATE TABLE IF NOT EXISTS donations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    amount     INTEGER  NOT NULL CHECK (amount > 0),
    comment    VARCHAR(200),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reviews_film  ON reviews(film_id);
CREATE INDEX IF NOT EXISTS idx_ucards_user   ON user_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
