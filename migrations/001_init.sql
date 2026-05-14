CREATE TABLE IF NOT EXISTS chunks (
  id          TEXT PRIMARY KEY,
  symbol      TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  chunk_type  TEXT NOT NULL,
  description TEXT NOT NULL,
  repo        TEXT,
  created_at  INTEGER DEFAULT (unixepoch())
);
