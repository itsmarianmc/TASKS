import type { LocalMutation } from "./schemas";
import type { LocalSnapshot, TaskMetadata } from "./types";
import type { OptimisticCache } from "./optimistic";
import { clientId } from "./client-id";

export function replaceWhere<T>(items: T[], matches: (item: T) => boolean, updates: T[]): T[] {
  const first = items.findIndex(matches);
  const result = items.filter(item => !matches(item));
  result.splice(first < 0 ? result.length : first, 0, ...updates);
  return result;
}
export const initialMetadata = (taskId: string, now: string): TaskMetadata => ({ taskId, priority: "none", recurrenceRule: null, reminderAt: null, reminderDismissedAt: null, someday: false, createdAt: now, updatedAt: now });
export function prepareLocal(action: LocalMutation): LocalMutation {
  if ((action.action === "saveAlias" || action.action === "saveFilter") && !action.id) return { ...action, id: clientId() };
  if (action.action === "saveDraft" && !action.draft.id) return { ...action, draft: { ...action.draft, id: clientId() } };
  return action;
}
export function resolveLocal(action: LocalMutation, cache: OptimisticCache): LocalMutation {
  const result = { ...action };
  if ("taskId" in result) result.taskId = cache.resolveId(result.taskId);
  if ("entityId" in result && result.entityType === "task") result.entityId = cache.resolveId(result.entityId);
  if ("id" in result && result.id) result.id = cache.resolveId(result.id);
  return result;
}
export function localLane(action: LocalMutation, local: LocalSnapshot | undefined, cache: OptimisticCache) {
  if (action.action === "saveAlias" || action.action === "deleteAlias") return `alias:${action.id}`;
  if ("taskId" in action) return cache.entityKey("task", action.taskId);
  if ("entityId" in action) return cache.entityKey(action.entityType, action.entityId);
  if (action.action === "setPreferences") return `preferences:${Object.keys(action.patch).sort().join(",")}`;
  if (action.action === "saveIntegration") return `integration:${action.projectId}`;
  if (action.action === "deleteIntegration") return `integration:${local?.integrations.find(item => item.id === action.id)?.projectId ?? action.id}`;
  if (action.action === "deleteLink" || action.action === "updateLink") { const link = local?.links.find(item => item.id === action.id); return link ? cache.entityKey(link.entityType, link.entityId) : `link:${action.id}`; }
  if (action.action === "saveFilter" || action.action === "deleteFilter") return `filter:${action.id}`;
  if (action.action === "saveDraft") return `draft:${action.draft.id}`;
  if (action.action === "deleteDraft") return `draft:${action.id}`;
  if (action.action === "unlinkExternal") return `external:${action.id}`;
  return "notion-mapping";
}
export function applyLocal(local: LocalSnapshot, action: LocalMutation, id: string, now: string): LocalSnapshot {
  const entity = "entityId" in action ? (item: { entityType: string; entityId: string }) => item.entityId === action.entityId && item.entityType === action.entityType : () => false;
  switch (action.action) {
    case "saveNote": { const existing = local.notes.find(entity); return { ...local, notes: replaceWhere(local.notes, entity, [{ id: existing?.id ?? id, entityType: action.entityType, entityId: action.entityId, content: action.content, createdAt: existing?.createdAt ?? now, updatedAt: now, unsaved: true }]) }; }
    case "deleteNote": return { ...local, notes: local.notes.filter(item => !entity(item)) };
    case "addLink": return { ...local, links: [...local.links, { id, entityType: action.entityType, entityId: action.entityId, label: action.label || new URL(action.url).hostname, url: action.url, createdAt: now }] };
    case "deleteLink": return { ...local, links: local.links.filter(item => item.id !== action.id) };
    case "updateLink": return { ...local, links: local.links.map(item => item.id === action.id ? { ...item, label: action.label || new URL(action.url).hostname, url: action.url } : item) };
    case "setTaskMetadata": { const existing = local.metadata.find(item => item.taskId === action.taskId) ?? initialMetadata(action.taskId, now); return { ...local, metadata: replaceWhere(local.metadata, item => item.taskId === action.taskId, [{ ...existing, ...action.patch, updatedAt: now }]) }; }
    case "setTaskTags": {
      const tags = [...local.tags], assignments = local.taskTags.filter(item => item.taskId !== action.taskId);
      for (const name of [...new Set(action.tags.map(name => name.trim().normalize("NFC")))]) {
        let tag = tags.find(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
        if (!tag) { tag = { id: `${id}:tag:${tags.length}`, name, color: null }; tags.push(tag); }
        assignments.push({ taskId: action.taskId, tagId: tag.id });
      }
      return { ...local, tags, taskTags: assignments };
    }
    case "saveFilter": return { ...local, filters: replaceWhere(local.filters, item => item.id === action.id, [{ id: action.id!, name: action.name, criteria: action.criteria, createdAt: local.filters.find(item => item.id === action.id)?.createdAt ?? now, updatedAt: now }]) };
    case "deleteFilter": return { ...local, filters: local.filters.filter(item => item.id !== action.id) };
    case "saveAlias": return { ...local, aliases: replaceWhere(local.aliases, item => item.id === action.id, [{ id: action.id!, entityType: action.entityType, entityId: action.entityId, alias: action.alias }]) };
    case "deleteAlias": return { ...local, aliases: local.aliases.filter(item => item.id !== action.id) };
    case "saveIntegration": return { ...local, integrations: replaceWhere(local.integrations, item => item.projectId === action.projectId, [{ id: local.integrations.find(item => item.projectId === action.projectId)?.id ?? id, projectId: action.projectId, source: "github", repository: action.repository, createdAt: now }]) };
    case "deleteIntegration": return { ...local, integrations: local.integrations.filter(item => item.id !== action.id) };
    case "setPreferences": return { ...local, preferences: { ...local.preferences, ...action.patch } };
    case "setNotionMapping": return { ...local, notionMapping: action.mapping };
    case "saveDraft": return { ...local, drafts: replaceWhere(local.drafts, item => item.id === action.draft.id, [{ ...action.draft, id: action.draft.id!, createdAt: local.drafts.find(item => item.id === action.draft.id)?.createdAt ?? now, updatedAt: now }]) };
    case "deleteDraft": return { ...local, drafts: local.drafts.filter(item => item.id !== action.id) };
    case "linkExternal": return { ...local, externalLinks: replaceWhere(local.externalLinks, item => item.source === action.source && item.externalId === action.externalId, [{ id, source: action.source, externalId: action.externalId, taskId: action.taskId, url: action.url, createdAt: now }]) };
    case "unlinkExternal": return { ...local, externalLinks: local.externalLinks.filter(item => item.id !== action.id) };
  }
}

/** A POST returns a full SQLite snapshot; only the tables/rows this action owns are accepted. */
export function reconcileLocal(local: LocalSnapshot, confirmed: LocalSnapshot, action: LocalMutation, temporary: string, cache: OptimisticCache): LocalSnapshot {
  const entity = "entityId" in action ? (item: { entityType: string; entityId: string }) => item.entityId === action.entityId && item.entityType === action.entityType : () => false;
  const merge = <K extends "notes" | "links" | "metadata" | "taskTags" | "filters" | "aliases" | "integrations" | "drafts" | "externalLinks">(table: K, matches: (item: LocalSnapshot[K][number]) => boolean): LocalSnapshot => {
    const rows = confirmed[table].filter(matches as never);
    if (rows.length === 1 && "id" in rows[0]) cache.assignId(temporary, rows[0].id as string);
    return { ...local, [table]: replaceWhere(local[table] as LocalSnapshot[K][number][], matches, rows as LocalSnapshot[K][number][]) };
  };
  switch (action.action) {
    case "saveNote": case "deleteNote": return merge("notes", entity);
    case "addLink": {
      const rows = confirmed.links.filter(item => entity(item) && !local.links.some(old => old.id === item.id));
      if (rows[0]) cache.assignId(temporary, rows[0].id);
      return { ...local, links: replaceWhere(local.links, item => item.id === temporary, rows) };
    }
    case "deleteLink": return { ...local, links: local.links.filter(item => item.id !== action.id) };
    case "updateLink": return merge("links", item => item.id === action.id);
    case "setTaskMetadata": return merge("metadata", item => item.taskId === action.taskId);
    case "setTaskTags": {
      const tags = [...local.tags];
      const taskTags = confirmed.taskTags.filter(item => item.taskId === action.taskId);
      for (const assignment of taskTags) { const tag = confirmed.tags.find(item => item.id === assignment.tagId); if (tag && !tags.some(item => item.id === tag.id)) tags.push(tag); }
      return { ...local, tags, taskTags: replaceWhere(local.taskTags, item => item.taskId === action.taskId, taskTags) };
    }
    case "saveFilter": case "deleteFilter": return merge("filters", item => item.id === action.id);
    case "saveAlias": case "deleteAlias": return merge("aliases", item => item.id === action.id);
    case "saveIntegration": return merge("integrations", item => item.projectId === action.projectId);
    case "deleteIntegration": return { ...local, integrations: local.integrations.filter(item => item.id !== action.id) };
    case "setPreferences": return { ...local, preferences: { ...local.preferences, ...Object.fromEntries(Object.keys(action.patch).map(key => [key, confirmed.preferences[key as keyof typeof confirmed.preferences]])) } };
    case "setNotionMapping": return { ...local, notionMapping: confirmed.notionMapping };
    case "saveDraft": return merge("drafts", item => item.id === action.draft.id);
    case "deleteDraft": return { ...local, drafts: local.drafts.filter(item => item.id !== action.id) };
    case "linkExternal": return merge("externalLinks", item => item.source === action.source && item.externalId === action.externalId);
    case "unlinkExternal": return { ...local, externalLinks: local.externalLinks.filter(item => item.id !== action.id) };
  }
}
export function localErrorMessage(action: LocalMutation) {
  if (action.action.includes("Note")) return action.action === "saveNote" ? "Couldn't save note." : "Couldn't delete note.";
  if (action.action.includes("Link")) return "Couldn't update link.";
  if (action.action === "setTaskTags") return "Couldn't update tags.";
  if (action.action === "setTaskMetadata") return "Couldn't update task.";
  if (action.action === "setPreferences") return "Couldn't save preferences.";
  return "Couldn't save changes.";
}
