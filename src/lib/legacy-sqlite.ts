import Database from "better-sqlite3";

/*
 * The SQLite schema of Tidewiki 1.x, kept only to read an existing wiki.db once and move it into
 * PostgreSQL (lib/sqlite-import.ts). Opening an older file runs these migrations first, so every
 * 1.x database arrives at the same shape (version 6) before it is copied.
 */
type DB = Database.Database;

const SCHEMA = `
CREATE TABLE users(
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),
  disabled INTEGER NOT NULL DEFAULT 0,
  totp_secret_enc TEXT,
  totp_pending_enc TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  totp_last_step INTEGER NOT NULL DEFAULT 0,
  recovery_hashes TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  password_changed_at INTEGER NOT NULL
);
CREATE TABLE sessions(
  id_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('full','mfa')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE reset_tokens(
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE pages(
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  parent_id INTEGER REFERENCES pages(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL DEFAULT '',
  rev INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX pages_parent ON pages(parent_id, position, title);
CREATE TABLE page_revisions(
  id INTEGER PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  rev INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(page_id, rev)
);
CREATE VIRTUAL TABLE pages_fts USING fts5(title, content, content='pages', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER pages_ai AFTER INSERT ON pages BEGIN
  INSERT INTO pages_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;
CREATE TRIGGER pages_ad AFTER DELETE ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
END;
CREATE TRIGGER pages_au AFTER UPDATE OF title, content ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
  INSERT INTO pages_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;
CREATE TABLE audit_log(
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  user_id INTEGER,
  event TEXT NOT NULL,
  ip TEXT,
  detail TEXT
);
CREATE TABLE rate_limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
`;

// v2: owner (super admin), escalating lock-outs, audit targets + search indexes, built-in page markers.
const MIGRATION_2 = `
ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0;
UPDATE users SET is_owner=1 WHERE id=(SELECT MIN(id) FROM users WHERE role='admin');
CREATE TABLE lockouts(
  key TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  fails INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX lockouts_user ON lockouts(user_id);
DELETE FROM rate_limits WHERE key LIKE 'fail:%';
ALTER TABLE audit_log ADD COLUMN target_id INTEGER;
CREATE INDEX audit_ts ON audit_log(ts);
CREATE INDEX audit_user ON audit_log(user_id);
CREATE INDEX audit_target ON audit_log(target_id);
CREATE INDEX audit_event ON audit_log(event);
ALTER TABLE pages ADD COLUMN system_key TEXT;
UPDATE pages SET system_key='welcome' WHERE slug='welcome';
UPDATE pages SET system_key='markdown-guide' WHERE slug='markdown-guide';
`;

// v4: index of links between pages ("Linked from"), filled by the application.
const MIGRATION_4 = `
CREATE TABLE page_links(
  from_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  to_slug TEXT NOT NULL,
  PRIMARY KEY(from_id, to_slug)
);
CREATE INDEX page_links_to ON page_links(to_slug);
CREATE INDEX revisions_time ON page_revisions(created_at);
`;

// v5: several authenticator devices per person, substring search index, per-role MFA.
const MIGRATION_5 = `
CREATE TABLE totp_devices(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  secret_enc TEXT NOT NULL,
  last_step INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX totp_devices_user ON totp_devices(user_id);
INSERT INTO totp_devices(user_id,name,secret_enc,last_step,created_at)
  SELECT id, 'Authenticator', totp_secret_enc, totp_last_step, password_changed_at FROM users WHERE totp_enabled=1 AND totp_secret_enc IS NOT NULL;
UPDATE users SET totp_secret_enc=NULL;
-- Substring search: normalised text (lower case, no accents) in a trigram index, original plain text for snippets.
-- Triggers only mark pages as dirty; lib/search.ts (re)computes the text, so every write path is covered.
DROP TRIGGER IF EXISTS pages_ai; DROP TRIGGER IF EXISTS pages_ad; DROP TRIGGER IF EXISTS pages_au;
DROP TABLE IF EXISTS pages_fts;
CREATE VIRTUAL TABLE search_idx USING fts5(title, body, plain UNINDEXED, tokenize='trigram remove_diacritics 2');
CREATE TABLE search_dirty(page_id INTEGER PRIMARY KEY);
INSERT INTO search_dirty(page_id) SELECT id FROM pages;
CREATE TRIGGER search_ai AFTER INSERT ON pages BEGIN INSERT OR IGNORE INTO search_dirty(page_id) VALUES(new.id); END;
CREATE TRIGGER search_au AFTER UPDATE OF title, content ON pages BEGIN INSERT OR IGNORE INTO search_dirty(page_id) VALUES(new.id); END;
CREATE TRIGGER search_ad AFTER DELETE ON pages BEGIN DELETE FROM search_idx WHERE rowid=old.id; DELETE FROM search_dirty WHERE page_id=old.id; END;
INSERT INTO settings(key,value) SELECT 'require_2fa_admin', value FROM settings WHERE key='require_2fa';
INSERT INTO settings(key,value) SELECT 'require_2fa_editor', value FROM settings WHERE key='require_2fa';
INSERT INTO settings(key,value) SELECT 'require_2fa_viewer', value FROM settings WHERE key='require_2fa';
DELETE FROM settings WHERE key='require_2fa';
`;

// v6: trash for deleted pages (with their whole history) and richer versions
// (an optional edit summary, and which version a restore came from).
const MIGRATION_6 = `
ALTER TABLE page_revisions ADD COLUMN comment TEXT;
ALTER TABLE page_revisions ADD COLUMN restored_from INTEGER;
CREATE TABLE trash(
  id INTEGER PRIMARY KEY,
  page_id INTEGER NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  parent_id INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  rev INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  system_key TEXT,
  children TEXT NOT NULL DEFAULT '[]',
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at INTEGER NOT NULL
);
CREATE INDEX trash_deleted ON trash(deleted_at);
CREATE TABLE trash_revisions(
  trash_id INTEGER NOT NULL REFERENCES trash(id) ON DELETE CASCADE,
  orig_id INTEGER,
  rev INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  comment TEXT,
  restored_from INTEGER,
  PRIMARY KEY(trash_id, rev)
);
`;

// v3: uploaded media and per-language overrides for the legal pages.
const MIGRATION_3 = `
CREATE TABLE media(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('image','video')),
  size INTEGER NOT NULL,
  original_name TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX media_user ON media(created_by);
CREATE TABLE legal_pages(
  key TEXT NOT NULL CHECK(key IN ('privacy','terms','imprint')),
  lang TEXT NOT NULL CHECK(lang IN ('de','en')),
  content TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(key, lang)
);
`;

/** Opens and migrates a database. `upTo` stops at an older schema version (used by the upgrade tests). */
/** The schema this build writes. Backups from newer builds are refused, older ones migrated. */
export const LEGACY_SCHEMA_VERSION = 6;

export function openLegacySqlite(file: string, upTo = LEGACY_SCHEMA_VERSION): DB {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("secure_delete = ON");
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version < 1 && upTo >= 1) {
    db.transaction(() => {
      db.exec(SCHEMA);
      db.pragma("user_version = 1");
    })();
  }
  if (upTo >= 2 && (db.pragma("user_version", { simple: true }) as number) < 2) {
    db.transaction(() => {
      db.exec(MIGRATION_2);
      db.pragma("user_version = 2");
    })();
  }
  if (upTo >= 3 && (db.pragma("user_version", { simple: true }) as number) < 3) {
    db.transaction(() => {
      db.exec(MIGRATION_3);
      db.pragma("user_version = 3");
    })();
  }
  if (upTo >= 4 && (db.pragma("user_version", { simple: true }) as number) < 4) {
    db.transaction(() => {
      db.exec(MIGRATION_4);
      db.pragma("user_version = 4");
    })();
  }
  if (upTo >= 5 && (db.pragma("user_version", { simple: true }) as number) < 5) {
    db.transaction(() => {
      db.exec(MIGRATION_5);
      db.pragma("user_version = 5");
    })();
  }
  if (upTo >= 6 && (db.pragma("user_version", { simple: true }) as number) < 6) {
    db.transaction(() => {
      db.exec(MIGRATION_6);
      db.pragma("user_version = 6");
    })();
  }
  return db;
}
