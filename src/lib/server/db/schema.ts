import { integer, text, sqliteTable, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
import type { EntityType, FilterCriteria, NotionMapping, Preferences, Priority, RecurrenceRule } from "@/lib/types";

const entityColumns = () => ({ entityType: text("entity_type").$type<EntityType>().notNull(), entityId: text("entity_id").notNull() });
const timestamps = () => ({ createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull() });
export const metadata = sqliteTable("task_metadata", {
  taskId: text("notion_task_id").primaryKey(), priority: text("priority").$type<Priority>().notNull().default("none"),
  recurrenceRule: text("recurrence_rule", { mode: "json" }).$type<RecurrenceRule>(), reminderAt: text("reminder_at"), reminderDismissedAt: text("reminder_dismissed_at"),
  completedAt: text("completed_at"),
  someday: integer("someday", { mode: "boolean" }).notNull().default(false), ...timestamps(),
});
export const notes = sqliteTable("notes", { id: text("id").primaryKey(), ...entityColumns(), content: text("content").notNull(), ...timestamps() }, t => [uniqueIndex("notes_entity").on(t.entityType, t.entityId)]);
export const attachments = sqliteTable("attachments", { id: text("id").primaryKey(), ...entityColumns(), name: text("name").notNull(), storageName: text("storage_name").notNull(), mimeType: text("mime_type").notNull(), size: integer("size").notNull(), createdAt: text("created_at").notNull() });
export const links = sqliteTable("links", { id: text("id").primaryKey(), ...entityColumns(), label: text("label").notNull(), url: text("url").notNull(), createdAt: text("created_at").notNull() });
export const tags = sqliteTable("tags", { id: text("id").primaryKey(), name: text("name").notNull().unique(), color: text("color") });
export const taskTags = sqliteTable("task_tags", { taskId: text("notion_task_id").notNull(), tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }) }, t => [primaryKey({ columns: [t.taskId, t.tagId] })]);
export const filters = sqliteTable("saved_filters", { id: text("id").primaryKey(), name: text("name").notNull(), criteria: text("criteria", { mode: "json" }).$type<FilterCriteria>().notNull(), ...timestamps() });
export const aliases = sqliteTable("parser_aliases", { id: text("id").primaryKey(), entityType: text("entity_type").$type<"project" | "area">().notNull(), entityId: text("entity_id").notNull(), alias: text("alias").notNull() }, t => [uniqueIndex("aliases_entity_value").on(t.entityType, t.entityId, t.alias)]);
export const integrations = sqliteTable("project_integrations", { id: text("id").primaryKey(), projectId: text("project_id").notNull(), source: text("source").$type<"github">().notNull().default("github"), repository: text("repository").notNull(), createdAt: text("created_at").notNull() }, t => [uniqueIndex("integration_project_source").on(t.projectId, t.source)]);
export const externalLinks = sqliteTable("external_item_links", { id: text("id").primaryKey(), source: text("source").$type<"github" | "contact">().notNull(), externalId: text("external_id").notNull(), taskId: text("notion_task_id").notNull(), url: text("url"), createdAt: text("created_at").notNull() }, t => [uniqueIndex("external_source_id").on(t.source, t.externalId)]);
export const drafts = sqliteTable("inbox_drafts", {
  id: text("id").primaryKey(), input: text("input").notNull(), title: text("title").notNull(), areaId: text("area_id"), projectId: text("project_id"),
  dates: text("dates", { mode: "json" }).$type<{ start: string | null; end: string | null }>().notNull(), tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
  priority: text("priority").$type<Priority>().notNull(), recurrenceRule: text("recurrence_rule", { mode: "json" }).$type<RecurrenceRule>(),
  source: text("source").$type<"quick-add" | "github" | "contact">().notNull(), externalId: text("external_id"), externalUrl: text("external_url"), ...timestamps(),
});
export const preferences = sqliteTable("app_preferences", { key: text("key").primaryKey(), value: text("value", { mode: "json" }).$type<Preferences | NotionMapping>().notNull(), updatedAt: text("updated_at").notNull() });
export const pushSubscriptions = sqliteTable("web_push_subscriptions", { id: text("id").primaryKey(), endpoint: text("endpoint").notNull().unique(), p256dh: text("p256dh").notNull(), auth: text("auth").notNull(), deviceHash: text("device_hash").unique(), createdAt: text("created_at").notNull() });
export const pushDeliveries = sqliteTable("push_deliveries", {
  subscriptionId: text("subscription_id").notNull().references(() => pushSubscriptions.id, { onDelete: "cascade" }),
  taskId: text("task_id").notNull(), reminderAt: text("reminder_at").notNull(),
  state: text("state").$type<"sending" | "accepted" | "retry" | "exhausted">().notNull(),
  attempts: integer("attempts").notNull(), nextAttemptAt: integer("next_attempt_at").notNull(), updatedAt: integer("updated_at").notNull(), lastStatus: integer("last_status"),
}, table => [primaryKey({ columns: [table.subscriptionId, table.taskId, table.reminderAt] })]);
export const recurrenceLedger = sqliteTable("recurrence_ledger", {
  sourceTaskId: text("source_task_id").primaryKey(), nextTaskId: text("next_task_id"), state: text("state").$type<"creating" | "complete" | "failed">().notNull(), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
});
export const externalConversionLedger = sqliteTable("external_conversion_ledger", {
  source: text("source").$type<"github" | "contact">().notNull(), externalId: text("external_id").notNull(),
  taskId: text("notion_task_id"), state: text("state").$type<"creating" | "complete" | "uncertain">().notNull(), ...timestamps(),
}, table => [primaryKey({ columns: [table.source, table.externalId] })]);
export const draftConversionLedger = sqliteTable("draft_conversion_ledger", {
  source: text("source").$type<"draft">().notNull(), externalId: text("external_id").notNull(),
  taskId: text("notion_task_id"), state: text("state").$type<"creating" | "complete" | "uncertain">().notNull(), ...timestamps(),
}, table => [primaryKey({ columns: [table.source, table.externalId] })]);
