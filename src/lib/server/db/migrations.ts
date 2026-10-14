/** Versioned, transactional migrations are bundled into the standalone server. */
export const migrations = [{ version: 1, sql: `
CREATE TABLE task_metadata (notion_task_id TEXT PRIMARY KEY, priority TEXT NOT NULL DEFAULT 'none', recurrence_rule TEXT, reminder_at TEXT, reminder_dismissed_at TEXT, someday INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE notes (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL CHECK(entity_type IN ('task','project','area')), entity_id TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX notes_entity ON notes(entity_type,entity_id);
CREATE TABLE attachments (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL CHECK(entity_type IN ('task','project','area')), entity_id TEXT NOT NULL, name TEXT NOT NULL, storage_name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX attachments_entity ON attachments(entity_type,entity_id);
CREATE TABLE links (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL CHECK(entity_type IN ('task','project','area')), entity_id TEXT NOT NULL, label TEXT NOT NULL, url TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX links_entity ON links(entity_type,entity_id);
CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, color TEXT);
CREATE TABLE task_tags (notion_task_id TEXT NOT NULL, tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(notion_task_id,tag_id));
CREATE TABLE saved_filters (id TEXT PRIMARY KEY, name TEXT NOT NULL, criteria TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE parser_aliases (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL CHECK(entity_type IN ('project','area')), entity_id TEXT NOT NULL, alias TEXT NOT NULL COLLATE NOCASE);
CREATE UNIQUE INDEX aliases_entity_value ON parser_aliases(entity_type,entity_id,alias);
CREATE TABLE project_integrations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'github', repository TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX integration_project_source ON project_integrations(project_id,source);
CREATE TABLE external_item_links (id TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL, notion_task_id TEXT NOT NULL, url TEXT, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX external_source_id ON external_item_links(source,external_id);
CREATE TABLE inbox_drafts (id TEXT PRIMARY KEY, input TEXT NOT NULL, title TEXT NOT NULL, area_id TEXT, project_id TEXT, dates TEXT NOT NULL, tags TEXT NOT NULL, priority TEXT NOT NULL, recurrence_rule TEXT, source TEXT NOT NULL, external_id TEXT, external_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE app_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE web_push_subscriptions (id TEXT PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE recurrence_ledger (source_task_id TEXT PRIMARY KEY, next_task_id TEXT, state TEXT NOT NULL CHECK(state IN ('creating','complete','failed')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
` }, { version: 2, sql: `
CREATE TABLE external_conversion_ledger (source TEXT NOT NULL CHECK(source IN ('github','contact')), external_id TEXT NOT NULL, notion_task_id TEXT, state TEXT NOT NULL CHECK(state IN ('creating','complete','uncertain')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(source,external_id));
` }, { version: 3, sql: `
CREATE TABLE draft_conversion_ledger (source TEXT NOT NULL CHECK(source='draft'), external_id TEXT NOT NULL, notion_task_id TEXT, state TEXT NOT NULL CHECK(state IN ('creating','complete','uncertain')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(source,external_id));
` }, { version: 4, sql: `
ALTER TABLE task_metadata ADD COLUMN completed_at TEXT;
` }, { version: 5, sql: `
CREATE TABLE notion_graph_cache (config_key TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
` }, { version: 6, sql: `
ALTER TABLE web_push_subscriptions ADD COLUMN device_hash TEXT;
CREATE UNIQUE INDEX web_push_device ON web_push_subscriptions(device_hash);
CREATE TABLE push_deliveries (
 subscription_id TEXT NOT NULL REFERENCES web_push_subscriptions(id) ON DELETE CASCADE,
 task_id TEXT NOT NULL, reminder_at TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('sending','accepted','retry','exhausted')),
 attempts INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL, last_status INTEGER,
 PRIMARY KEY(subscription_id,task_id,reminder_at)
);
` }];
