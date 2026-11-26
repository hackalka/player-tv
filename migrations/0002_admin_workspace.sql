-- Workspace administrativo: copias y metadatos separados del catálogo Telegram.
CREATE TABLE IF NOT EXISTS admin_backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  backup_type TEXT NOT NULL,
  label TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_backups_created
  ON admin_backups (created_at DESC);

CREATE TABLE IF NOT EXISTS admin_catalog_overrides (
  item_key TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  poster_url TEXT,
  genres_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_catalog_overrides_topic
  ON admin_catalog_overrides (group_id, topic_id);
