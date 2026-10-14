import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, desc } from "drizzle-orm";
import { getDatabase, type LocalDatabase } from "./db";
import * as s from "./db/schema";
import { localMutationSchema, notionMappingSchema, preferencesPatchSchema, type LocalMutation } from "@/lib/schemas";
import type { LocalSnapshot, Preferences, NotionMapping, TaskMetadata, EntityRef } from "@/lib/types";
import { taskReconcileSchema, type NotionGraphCacheSnapshot, type TaskReconcile } from "@/lib/notion-contracts";
import { AppError } from "./http";

export const defaultPreferences: Preferences = { theme: "system", sidebarCollapsed: false, lastView: "overview", notificationPermissionAsked: false, showCompletedTasks: true, hideProjectsWithoutCurrentTasks: false };
const now = () => new Date().toISOString();
export function createRepository(database: LocalDatabase = getDatabase()) {
  const { orm, sqlite } = database;
  const entityCondition = (table: typeof s.notes | typeof s.links | typeof s.attachments, entity: EntityRef) => and(eq(table.entityType, entity.type), eq(table.entityId, entity.id));

  async function getPreferences(): Promise<Preferences> {
    const [row] = await orm.select().from(s.preferences).where(eq(s.preferences.key, "preferences"));
    const parsed = preferencesPatchSchema.safeParse(row?.value || {});
    return { ...defaultPreferences, ...(parsed.success ? parsed.data : {}) };
  }
  async function getNotionMapping(): Promise<NotionMapping> {
    const [row] = await orm.select().from(s.preferences).where(eq(s.preferences.key, "notionMapping"));
    const parsed = notionMappingSchema.safeParse(row?.value || {});
    return parsed.success ? parsed.data : {};
  }
  function getNotionGraphCache(configKey: string): NotionGraphCacheSnapshot | null {
    const row = sqlite.prepare("SELECT payload FROM notion_graph_cache WHERE config_key=?").get(configKey) as { payload: string } | undefined;
    if (!row) return null;
    try {
      const value: unknown = JSON.parse(row.payload);
      if (!value || typeof value !== "object") return null;
      const snapshot = value as Partial<NotionGraphCacheSnapshot>;
      const graph = snapshot.response?.graph;
      if (!graph || !Array.isArray(graph.areas) || !Array.isArray(graph.projects) || !Array.isArray(graph.tasks) || !(graph.syncedAt === null || typeof graph.syncedAt === "string") || !Array.isArray(snapshot.response?.diagnostics) || typeof snapshot.response?.completionEnabled !== "boolean" || typeof snapshot.cursor !== "string" || !(snapshot.lastFullSyncAt === null || typeof snapshot.lastFullSyncAt === "string")) return null;
      return { ...snapshot, history: Array.isArray(snapshot.history) ? snapshot.history : [] } as NotionGraphCacheSnapshot;
    } catch { return null; }
  }
  function saveNotionGraphCache(configKey: string, snapshot: NotionGraphCacheSnapshot) {
    sqlite.prepare("DELETE FROM notion_graph_cache WHERE config_key<>?").run(configKey);
    sqlite.prepare("INSERT INTO notion_graph_cache(config_key,payload,updated_at) VALUES (?,?,?) ON CONFLICT(config_key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").run(configKey, JSON.stringify(snapshot), now());
  }
  async function getMetadata(taskId: string): Promise<TaskMetadata> {
    const [row] = await orm.select().from(s.metadata).where(eq(s.metadata.taskId, taskId));
    return row || { taskId, priority: "none", recurrenceRule: null, reminderAt: null, reminderDismissedAt: null, someday: false, createdAt: now(), updatedAt: now() };
  }
  async function recordCompletion(taskId: string, completed: boolean) {
    const previous = await getMetadata(taskId);
    const value = { ...previous, completedAt: completed ? previous.completedAt ?? now() : null, updatedAt: now() };
    await orm.insert(s.metadata).values(value).onConflictDoUpdate({ target: s.metadata.taskId, set: { completedAt: value.completedAt, updatedAt: value.updatedAt } });
    return value.completedAt;
  }
  async function snapshot(): Promise<LocalSnapshot> {
    const [metadata, notes, attachments, links, tags, taskTags, aliases, filters, integrations, externalLinks, drafts, preferences, notionMapping] = await Promise.all([
      orm.select().from(s.metadata), orm.select().from(s.notes), orm.select().from(s.attachments),
      orm.select().from(s.links), orm.select().from(s.tags), orm.select().from(s.taskTags), orm.select().from(s.aliases),
      orm.select().from(s.filters), orm.select().from(s.integrations), orm.select().from(s.externalLinks),
      orm.select().from(s.drafts).orderBy(desc(s.drafts.updatedAt)), getPreferences(), getNotionMapping(),
    ]);
    return { metadata, notes, attachments: attachments.map(({ storageName: _private, ...attachment }) => attachment), links, tags, taskTags, aliases, filters, integrations, externalLinks, drafts, preferences, notionMapping };
  }

  async function mutate(input: LocalMutation): Promise<unknown> {
    // Validate even server-to-server callers. Core Notion fields have no local write action.
    const action = localMutationSchema.parse(input);
    const timestamp = now();
    switch (action.action) {
      case "saveNote": {
        const value = { id: randomUUID(), entityType: action.entityType, entityId: action.entityId, content: action.content, createdAt: timestamp, updatedAt: timestamp };
        await orm.insert(s.notes).values(value).onConflictDoUpdate({ target: [s.notes.entityType, s.notes.entityId], set: { content: action.content, updatedAt: timestamp } });
        return (await orm.select().from(s.notes).where(entityCondition(s.notes, { type: action.entityType, id: action.entityId })))[0];
      }
      case "deleteNote":
        await orm.delete(s.notes).where(entityCondition(s.notes, { type: action.entityType, id: action.entityId })); return null;
      case "addLink": {
        const value = { id: randomUUID(), entityType: action.entityType, entityId: action.entityId, label: action.label || new URL(action.url).hostname, url: action.url, createdAt: timestamp };
        await orm.insert(s.links).values(value); return value;
      }
      case "deleteLink": await orm.delete(s.links).where(eq(s.links.id, action.id)); return null;
      case "updateLink": {
        const value = await orm.update(s.links).set({ label: action.label || new URL(action.url).hostname, url: action.url }).where(eq(s.links.id, action.id)).returning();
        if (!value[0]) throw new AppError("LINK_NOT_FOUND", "This link is no longer available.", 404);
        return value[0];
      }
      case "setTaskMetadata": {
        const value = { ...await getMetadata(action.taskId), ...action.patch, taskId: action.taskId, updatedAt: timestamp };
        await orm.insert(s.metadata).values(value).onConflictDoUpdate({ target: s.metadata.taskId, set: { ...action.patch, updatedAt: timestamp } });
        return getMetadata(action.taskId);
      }
      case "setTaskTags": {
        // All operations execute synchronously under one write lock, so a failed
        // replacement cannot leave the task with only some of its requested tags.
        const normalized = [...new Set(action.tags.map(tag => tag.normalize("NFC").trim().toLocaleLowerCase("en")))];
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          sqlite.prepare("DELETE FROM task_tags WHERE notion_task_id=?").run(action.taskId);
          for (const name of normalized) {
            sqlite.prepare("INSERT INTO tags(id,name,color) VALUES (?,?,NULL) ON CONFLICT(name) DO NOTHING").run(randomUUID(), name);
            const tag = sqlite.prepare("SELECT id FROM tags WHERE name=?").get(name);
            if (!tag) throw new Error("Unable to resolve saved tag.");
            sqlite.prepare("INSERT INTO task_tags(notion_task_id,tag_id) VALUES (?,?)").run(action.taskId, tag.id);
          }
          sqlite.exec("COMMIT");
        } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
        return normalized;
      }
      case "saveFilter": {
        const value = { id: action.id || randomUUID(), name: action.name, criteria: action.criteria, createdAt: timestamp, updatedAt: timestamp };
        await orm.insert(s.filters).values(value).onConflictDoUpdate({ target: s.filters.id, set: { name: action.name, criteria: action.criteria, updatedAt: timestamp } });
        return (await orm.select().from(s.filters).where(eq(s.filters.id, value.id)))[0];
      }
      case "deleteFilter": await orm.delete(s.filters).where(eq(s.filters.id, action.id)); return null;
      case "saveAlias": {
        const value = { id: action.id || randomUUID(), entityType: action.entityType, entityId: action.entityId, alias: action.alias.normalize("NFC") };
        if (action.id) await orm.insert(s.aliases).values(value).onConflictDoUpdate({ target: s.aliases.id, set: { entityType: value.entityType, entityId: value.entityId, alias: value.alias } });
        else await orm.insert(s.aliases).values(value).onConflictDoNothing();
        return (await orm.select().from(s.aliases).where(and(eq(s.aliases.entityType, value.entityType), eq(s.aliases.entityId, value.entityId), eq(s.aliases.alias, value.alias))))[0];
      }
      case "deleteAlias": await orm.delete(s.aliases).where(eq(s.aliases.id, action.id)); return null;
      case "saveIntegration": {
        const value = { id: randomUUID(), projectId: action.projectId, source: "github" as const, repository: action.repository, createdAt: timestamp };
        await orm.insert(s.integrations).values(value).onConflictDoUpdate({ target: [s.integrations.projectId, s.integrations.source], set: { repository: value.repository } });
        return (await orm.select().from(s.integrations).where(eq(s.integrations.projectId, value.projectId)))[0];
      }
      case "deleteIntegration": await orm.delete(s.integrations).where(eq(s.integrations.id, action.id)); return null;
      case "setPreferences": {
        // Read and merge under the same synchronous write lock. Independent UI
        // patches (theme, navigation, sidebar) must never replace each other.
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          const row = sqlite.prepare("SELECT value FROM app_preferences WHERE key='preferences'").get();
          const parsed = preferencesPatchSchema.safeParse(row ? JSON.parse(String(row.value)) : {});
          const value = { ...defaultPreferences, ...(parsed.success ? parsed.data : {}), ...action.patch };
          sqlite.prepare("INSERT INTO app_preferences(key,value,updated_at) VALUES ('preferences',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(JSON.stringify(value), timestamp);
          sqlite.exec("COMMIT");
          return value;
        } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      }
      case "setNotionMapping":
        await orm.insert(s.preferences).values({ key: "notionMapping", value: action.mapping, updatedAt: timestamp }).onConflictDoUpdate({ target: s.preferences.key, set: { value: action.mapping, updatedAt: timestamp } }); return action.mapping;
      case "saveDraft": {
        if (action.draft.id) {
          const previous = sqlite.prepare("SELECT source,external_id FROM inbox_drafts WHERE id=?").get(action.draft.id);
          if (previous && (previous.source !== action.draft.source || previous.external_id !== action.draft.externalId)) throw new AppError("DRAFT_SOURCE", "Keep the draft's original source.", 409);
        }
        const value = { ...action.draft, id: action.draft.id || randomUUID(), createdAt: timestamp, updatedAt: timestamp };
        const { id: _id, createdAt: _createdAt, ...update } = value;
        await orm.insert(s.drafts).values(value).onConflictDoUpdate({ target: s.drafts.id, set: update });
        return (await orm.select().from(s.drafts).where(eq(s.drafts.id, value.id)))[0];
      }
      case "deleteDraft": await orm.delete(s.drafts).where(eq(s.drafts.id, action.id)); return null;
      case "linkExternal": {
        const value = { id: randomUUID(), source: action.source, externalId: action.externalId, taskId: action.taskId, url: action.url, createdAt: timestamp };
        // One explicit conversion per external item. A conflicting conversion must
        // be resolved by the caller, never silently retarget an existing link.
        const ledger = getExternalConversion(action.source, action.externalId);
        if (ledger?.state === "creating" || (ledger?.taskId && ledger.taskId !== action.taskId)) throw new AppError("CONVERSION_CONFLICT", "This conversion is in progress or already points to a different task.", 409);
        const existing = sqlite.prepare("SELECT notion_task_id AS taskId FROM external_item_links WHERE source=? AND external_id=?").get(action.source, action.externalId);
        if (existing && existing.taskId !== action.taskId) throw new AppError("CONVERSION_CONFLICT", "This source already points to a different confirmed task.", 409);
        await orm.insert(s.externalLinks).values(value).onConflictDoNothing();
        return (await orm.select().from(s.externalLinks).where(and(eq(s.externalLinks.source, value.source), eq(s.externalLinks.externalId, value.externalId))))[0];
      }
      case "unlinkExternal": await orm.delete(s.externalLinks).where(eq(s.externalLinks.id, action.id)); return null;
    }
  }

  async function getAttachment(id: string) { return (await orm.select().from(s.attachments).where(eq(s.attachments.id, id)))[0] || null; }
  async function addAttachment(value: typeof s.attachments.$inferInsert) { await orm.insert(s.attachments).values(value); return value; }
  async function removeAttachment(id: string) { await orm.delete(s.attachments).where(eq(s.attachments.id, id)); }
  function claimRecurrence(taskId: string): boolean {
    const timestamp = now();
    return sqlite.prepare("INSERT INTO recurrence_ledger(source_task_id,next_task_id,state,created_at,updated_at) VALUES (?,NULL,'creating',?,?) ON CONFLICT(source_task_id) DO NOTHING").run(taskId, timestamp, timestamp).changes === 1;
  }
  function getRecurrence(taskId: string) { return sqlite.prepare("SELECT source_task_id AS sourceTaskId,next_task_id AS nextTaskId,state,created_at AS createdAt,updated_at AS updatedAt FROM recurrence_ledger WHERE source_task_id=?").get(taskId) || null; }
  function finishRecurrence(taskId: string, nextTaskId: string) { sqlite.prepare("UPDATE recurrence_ledger SET state='complete',next_task_id=?,updated_at=? WHERE source_task_id=? AND state='creating'").run(nextTaskId, now(), taskId); }
  function failRecurrence(taskId: string) { sqlite.prepare("UPDATE recurrence_ledger SET state='failed',updated_at=? WHERE source_task_id=? AND state='creating'").run(now(), taskId); }
  const conversionTable = (source: "github" | "contact" | "draft") => source === "draft" ? "draft_conversion_ledger" : "external_conversion_ledger";
  function claimExternalConversion(source: "github" | "contact" | "draft", externalId: string) {
    const timestamp = now();
    return sqlite.prepare(`INSERT INTO ${conversionTable(source)}(source,external_id,state,created_at,updated_at) VALUES (?,?,'creating',?,?) ON CONFLICT(source,external_id) DO NOTHING`).run(source, externalId, timestamp, timestamp).changes === 1;
  }
  function getExternalConversion(source: "github" | "contact" | "draft", externalId: string) { return sqlite.prepare(`SELECT notion_task_id AS taskId,state FROM ${conversionTable(source)} WHERE source=? AND external_id=?`).get(source, externalId) || null; }
  function finishExternalConversion(source: "github" | "contact" | "draft", externalId: string, taskId: string) {
    const existing = getExternalConversion(source, externalId);
    if (existing?.taskId && existing.taskId !== taskId) throw new AppError("CONVERSION_CONFLICT", "A confirmed conversion cannot be retargeted.", 409);
    sqlite.prepare(`UPDATE ${conversionTable(source)} SET state='complete',notion_task_id=?,updated_at=? WHERE source=? AND external_id=?`).run(taskId, now(), source, externalId);
  }
  function failExternalConversion(source: "github" | "contact" | "draft", externalId: string) { sqlite.prepare(`UPDATE ${conversionTable(source)} SET state='uncertain',updated_at=? WHERE source=? AND external_id=? AND state='creating'`).run(now(), source, externalId); }
  function releaseExternalConversion(source: "github" | "contact" | "draft", externalId: string) { sqlite.prepare(`DELETE FROM ${conversionTable(source)} WHERE source=? AND external_id=? AND state='creating'`).run(source, externalId); }
  function reconcileConversion(input: TaskReconcile) {
    const action = taskReconcileSchema.parse(input);
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      if (action.draftId) {
        const draft = sqlite.prepare("SELECT source,external_id FROM inbox_drafts WHERE id=?").get(action.draftId);
        if (!draft && !getExternalConversion("draft", action.draftId)) throw new AppError("DRAFT_UNAVAILABLE", "This Inbox draft no longer exists.", 404);
        if (draft && (draft.source !== (action.source?.source ?? "quick-add") || draft.external_id !== (action.source?.externalId ?? null))) throw new AppError("DRAFT_SOURCE", "Keep the draft's original source when linking an existing task.", 409);
      }
      const keys = [...(action.draftId ? [{ source: "draft" as const, externalId: action.draftId }] : []), ...(action.source ? [action.source] : [])];
      for (const key of keys) {
        const existing = getExternalConversion(key.source, key.externalId);
        if (existing?.state === "creating") throw new AppError("CONVERSION_ACTIVE", "This conversion is still in progress. Wait for its outcome before linking an inspected task.", 409);
        if (existing?.taskId && existing.taskId !== action.taskId) throw new AppError("CONVERSION_CONFLICT", "A confirmed conversion cannot be retargeted. Inspect the original task.", 409);
      }
      if (action.source) {
        const previous = sqlite.prepare("SELECT notion_task_id AS taskId FROM external_item_links WHERE source=? AND external_id=?").get(action.source.source, action.source.externalId);
        if (previous && previous.taskId !== action.taskId) throw new AppError("CONVERSION_CONFLICT", "This source already points to a different confirmed task.", 409);
        sqlite.prepare("INSERT INTO external_item_links(id,source,external_id,notion_task_id,url,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(source,external_id) DO NOTHING").run(randomUUID(), action.source.source, action.source.externalId, action.taskId, action.source.url, now());
      }
      for (const key of keys) {
        sqlite.prepare(`INSERT INTO ${conversionTable(key.source)}(source,external_id,notion_task_id,state,created_at,updated_at) VALUES (?,?,?,'complete',?,?) ON CONFLICT(source,external_id) DO UPDATE SET notion_task_id=excluded.notion_task_id,state='complete',updated_at=excluded.updated_at`).run(key.source, key.externalId, action.taskId, now(), now());
      }
      sqlite.exec("COMMIT");
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  }
  return { snapshot, mutate, recordCompletion, getPreferences, getNotionMapping, getNotionGraphCache, saveNotionGraphCache, getMetadata, getAttachment, addAttachment, removeAttachment, claimRecurrence, getRecurrence, finishRecurrence, failRecurrence, claimExternalConversion, getExternalConversion, finishExternalConversion, failExternalConversion, releaseExternalConversion, reconcileConversion };
}
export function repository() { return createRepository(); }
