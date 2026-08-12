/**
 * Siraya bagli migration listesi. Asla mevcut bir girdiyi degistirme veya silme;
 * sadece sona yeni SQL ekle. Uygulanan surum PRAGMA user_version'da tutulur.
 */
export const MIGRATIONS: string[] = [
  // 1 - ilk sema
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE groups (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    fb_group_id      TEXT    NOT NULL UNIQUE,
    name             TEXT    NOT NULL,
    url              TEXT    NOT NULL,
    dwell_ms         INTEGER NOT NULL DEFAULT 8000,
    priority         INTEGER NOT NULL DEFAULT 1,
    enabled          INTEGER NOT NULL DEFAULT 1,
    daily_action_cap INTEGER NOT NULL DEFAULT 10,
    created_at       INTEGER NOT NULL
  );

  CREATE TABLE templates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    kind       TEXT    NOT NULL CHECK (kind IN ('comment','dm')),
    -- JSON dizi: her gonderimde rastgele bir varyant secilir.
    -- Ayni metnin tekrari en guclu spam sinyali oldugu icin varyant sarttir.
    variants   TEXT    NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE rules (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT    NOT NULL,
    enabled             INTEGER NOT NULL DEFAULT 1,
    match_mode          TEXT    NOT NULL DEFAULT 'any' CHECK (match_mode IN ('any','all')),
    include_keywords    TEXT    NOT NULL DEFAULT '[]',
    exclude_keywords    TEXT    NOT NULL DEFAULT '[]',
    regex               TEXT,
    action_comment      INTEGER NOT NULL DEFAULT 0,
    action_dm           INTEGER NOT NULL DEFAULT 0,
    action_notify       INTEGER NOT NULL DEFAULT 1,
    -- 1 ise aksiyon once Telegram'da onay bekler, otomatik gonderilmez.
    require_approval    INTEGER NOT NULL DEFAULT 1,
    comment_template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL,
    dm_template_id      INTEGER REFERENCES templates(id) ON DELETE SET NULL,
    daily_cap           INTEGER NOT NULL DEFAULT 20,
    -- Bundan eski postlara aksiyon uygulanmaz (bayat post korumasi).
    max_post_age_min    INTEGER NOT NULL DEFAULT 30,
    priority            INTEGER NOT NULL DEFAULT 1,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
  );

  -- Bos birakilirsa kural TUM aktif gruplara uygulanir.
  CREATE TABLE rule_groups (
    rule_id  INTEGER NOT NULL REFERENCES rules(id)  ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    PRIMARY KEY (rule_id, group_id)
  );

  CREATE TABLE posts (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    fb_post_id         TEXT    NOT NULL UNIQUE,
    group_id           INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    permalink          TEXT    NOT NULL,
    author_name        TEXT,
    author_profile_url TEXT,
    author_user_id     TEXT,
    text               TEXT    NOT NULL DEFAULT '',
    image_urls         TEXT    NOT NULL DEFAULT '[]',
    posted_at          INTEGER,
    posted_at_label    TEXT,
    seen_at            INTEGER NOT NULL
  );

  CREATE TABLE matches (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id          INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    rule_id          INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
    matched_keywords TEXT    NOT NULL DEFAULT '[]',
    status           TEXT    NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','sent','failed','skipped','ignored')),
    created_at       INTEGER NOT NULL,
    UNIQUE (post_id, rule_id)
  );

  CREATE TABLE actions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id   INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL CHECK (kind IN ('comment','dm','telegram')),
    status     TEXT    NOT NULL
               CHECK (status IN ('queued','sending','sent','failed','dry_run','cancelled')),
    text       TEXT    NOT NULL DEFAULT '',
    -- Gonderim sonrasi postta gercekten gorundugu dogrulandi mi?
    verified   INTEGER NOT NULL DEFAULT 0,
    error      TEXT,
    created_at INTEGER NOT NULL,
    sent_at    INTEGER
  );

  -- Teshis gunlugu: heartbeat kesintisi, selector bozulmasi, blok tespiti vb.
  CREATE TABLE agent_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT    NOT NULL,
    level      TEXT    NOT NULL DEFAULT 'info' CHECK (level IN ('info','warn','error')),
    message    TEXT    NOT NULL DEFAULT '',
    payload    TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX idx_posts_seen_at   ON posts(seen_at DESC);
  CREATE INDEX idx_posts_group     ON posts(group_id, seen_at DESC);
  CREATE INDEX idx_matches_created ON matches(created_at DESC);
  CREATE INDEX idx_matches_status  ON matches(status, created_at DESC);
  CREATE INDEX idx_actions_status  ON actions(status, created_at);
  CREATE INDEX idx_actions_match   ON actions(match_id);
  CREATE INDEX idx_events_created  ON agent_events(created_at DESC);
  `,

  // 2 - konum cikarma ve mesafe filtresi
  `
  ALTER TABLE posts ADD COLUMN location_name TEXT;
  ALTER TABLE posts ADD COLUMN location_lat  REAL;
  ALTER TABLE posts ADD COLUMN location_lon  REAL;
  -- Ev konumuna kus ucusu uzaklik (km). Konum cikarilamadiysa NULL.
  ALTER TABLE posts ADD COLUMN distance_km   REAL;

  -- NULL = mesafe filtresi yok. Konumu bilinmeyen gonderiler elenmez.
  ALTER TABLE rules ADD COLUMN max_distance_km REAL;
  `,
];
