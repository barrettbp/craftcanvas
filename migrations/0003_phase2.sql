-- Phase 2: canvas objects, arrows, uploads, full-text search index.

CREATE TABLE IF NOT EXISTS assets (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,              -- image | pdf
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  r2_key       TEXT NOT NULL,
  width        INTEGER,
  height       INTEGER,
  page_count   INTEGER,
  text_status  TEXT NOT NULL DEFAULT 'none', -- none | pending | done
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_pages (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  page     INTEGER NOT NULL,
  text     TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (asset_id, page)
);

CREATE TABLE IF NOT EXISTS objects (
  id         TEXT PRIMARY KEY,
  board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                -- text | card | image | pdf | youtube
  x          REAL NOT NULL DEFAULT 0,
  y          REAL NOT NULL DEFAULT 0,
  w          REAL NOT NULL DEFAULT 240,
  h          REAL NOT NULL DEFAULT 120,
  z          INTEGER NOT NULL DEFAULT 0,
  section_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
  color      TEXT,
  title      TEXT,
  text       TEXT,
  url        TEXT,
  asset_id   TEXT REFERENCES assets(id) ON DELETE SET NULL,
  meta       TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS objects_board_idx ON objects(board_id);
CREATE INDEX IF NOT EXISTS objects_asset_idx ON objects(asset_id);

CREATE TABLE IF NOT EXISTS arrows (
  id            TEXT PRIMARY KEY,
  board_id      TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  source_kind   TEXT NOT NULL,             -- card | object
  source_id     TEXT NOT NULL,
  target_kind   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'parent_child', -- parent_child | related | custom
  label         TEXT,
  color         TEXT,
  source_handle TEXT,
  target_handle TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS arrows_board_idx ON arrows(board_id);
CREATE INDEX IF NOT EXISTS arrows_source_idx ON arrows(source_id);
CREATE INDEX IF NOT EXISTS arrows_target_idx ON arrows(target_id);

-- Search index: one row per searchable document (note, object, pdf page). `norm` is the
-- diacritics-folded lowercase text (đ -> d) so "viet" finds "Việt". FTS5 is kept in sync by triggers.
CREATE TABLE IF NOT EXISTS search_docs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  key      TEXT NOT NULL UNIQUE,           -- note:<id> | object:<id> | pdf_page:<assetId>:<page>
  doc_kind TEXT NOT NULL,                  -- note | object | pdf_page
  doc_id   TEXT NOT NULL,
  page     INTEGER,
  board_id TEXT,
  title    TEXT NOT NULL DEFAULT '',
  body     TEXT NOT NULL DEFAULT '',
  norm     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS search_docs_doc_idx ON search_docs(doc_kind, doc_id);

CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  title, body, norm,
  content='search_docs', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS search_docs_ai AFTER INSERT ON search_docs BEGIN
  INSERT INTO search_fts(rowid, title, body, norm) VALUES (new.id, new.title, new.body, new.norm);
END;
CREATE TRIGGER IF NOT EXISTS search_docs_ad AFTER DELETE ON search_docs BEGIN
  INSERT INTO search_fts(search_fts, rowid, title, body, norm) VALUES ('delete', old.id, old.title, old.body, old.norm);
END;
CREATE TRIGGER IF NOT EXISTS search_docs_au AFTER UPDATE ON search_docs BEGIN
  INSERT INTO search_fts(search_fts, rowid, title, body, norm) VALUES ('delete', old.id, old.title, old.body, old.norm);
  INSERT INTO search_fts(rowid, title, body, norm) VALUES (new.id, new.title, new.body, new.norm);
END;
