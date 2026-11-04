-- CraftCanvas schema v1. Notes/links are a read-only cache of Craft; boards/cards/sections/connections are ours.

CREATE TABLE IF NOT EXISTS notes (
  id            TEXT PRIMARY KEY,
  space_id      TEXT,
  title         TEXT NOT NULL DEFAULT '',
  folder_id     TEXT,
  folder_name   TEXT,
  created_at    TEXT,
  modified_at   TEXT,
  markdown      TEXT NOT NULL DEFAULT '',
  preview       TEXT NOT NULL DEFAULT '',
  deep_link_app TEXT NOT NULL DEFAULT '',
  deep_link_web TEXT NOT NULL DEFAULT '',
  synced_at     TEXT NOT NULL,
  deleted       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS notes_folder_idx ON notes(folder_id);
CREATE INDEX IF NOT EXISTS notes_modified_idx ON notes(modified_at);

CREATE TABLE IF NOT EXISTS links (
  source_note_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_block_id TEXT NOT NULL,
  target_note_id  TEXT,
  label           TEXT NOT NULL DEFAULT '',
  out_of_scope    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_note_id, target_block_id)
);
CREATE INDEX IF NOT EXISTS links_target_idx ON links(target_note_id);

CREATE TABLE IF NOT EXISTS boards (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  viewport_x    REAL NOT NULL DEFAULT 0,
  viewport_y    REAL NOT NULL DEFAULT 0,
  viewport_zoom REAL NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sections (
  id       TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name     TEXT NOT NULL DEFAULT '',
  x        REAL NOT NULL DEFAULT 0,
  y        REAL NOT NULL DEFAULT 0,
  w        REAL NOT NULL DEFAULT 600,
  h        REAL NOT NULL DEFAULT 400,
  color    TEXT
);
CREATE INDEX IF NOT EXISTS sections_board_idx ON sections(board_id);

CREATE TABLE IF NOT EXISTS cards (
  id         TEXT PRIMARY KEY,
  board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  x          REAL NOT NULL DEFAULT 0,
  y          REAL NOT NULL DEFAULT 0,
  w          REAL NOT NULL DEFAULT 260,
  h          REAL NOT NULL DEFAULT 160,
  folded     INTEGER NOT NULL DEFAULT 0,
  section_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
  z          INTEGER NOT NULL DEFAULT 0,
  UNIQUE (board_id, note_id)
);
CREATE INDEX IF NOT EXISTS cards_board_idx ON cards(board_id);
CREATE INDEX IF NOT EXISTS cards_note_idx ON cards(note_id);

CREATE TABLE IF NOT EXISTS connections (
  id             TEXT PRIMARY KEY,
  board_id       TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  source_note_id TEXT NOT NULL,
  target_note_id TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'manual',
  label          TEXT
);
CREATE INDEX IF NOT EXISTS connections_board_idx ON connections(board_id);

CREATE TABLE IF NOT EXISTS sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Every block id seen inside a document, so links that point at a sub-block resolve to its document.
CREATE TABLE IF NOT EXISTS note_blocks (
  block_id TEXT PRIMARY KEY,
  note_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS note_blocks_note_idx ON note_blocks(note_id);
