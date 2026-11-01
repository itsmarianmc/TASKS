import { z } from "zod";

export const idSchema = z.string().min(1).max(128).regex(/^[\w.:\-]+$/);
export const entityTypeSchema = z.enum(["task", "project", "area"]);
export const entityRefSchema = z.object({ type: entityTypeSchema, id: idSchema });
export const prioritySchema = z.enum(["none", "low", "medium", "high", "urgent"]);
export const isoDateSchema = z.iso.date();
export const datesSchema = z.object({ start: isoDateSchema.nullable(), end: isoDateSchema.nullable() }).refine(d => !d.start || !d.end || d.start <= d.end, { message: "Deadline must be on or after the start date." });
export const recurrenceSchema = z.object({ frequency: z.enum(["day", "week", "month", "year"]), interval: z.number().int().min(1).max(365) }).strict();
export const httpUrlSchema = z.string().url().max(4096).refine(value => {
  try {
    const url = new URL(value); return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch { return false; }
}, "Use an HTTP or HTTPS URL without credentials.");
export const taskInputSchema = z.object({ title: z.string().trim().min(1).max(2000), areaId: idSchema, projectId: idSchema, dates: datesSchema, highlight: z.boolean().optional() }).strict();
export const metadataPatchSchema = z.object({
  priority: prioritySchema.optional(), recurrenceRule: recurrenceSchema.nullable().optional(),
  reminderAt: z.iso.datetime({ offset: true }).nullable().optional(),
  reminderDismissedAt: z.iso.datetime({ offset: true }).nullable().optional(), someday: z.boolean().optional(),
}).strict();
export const filterCriteriaSchema = z.object({
  areaId: idSchema.optional(), projectId: idSchema.optional(), tagIds: z.array(idSchema).max(50).optional(),
  priority: prioritySchema.optional(), startDate: isoDateSchema.optional(), endDate: isoDateSchema.optional(),
  highlight: z.boolean().optional(), someday: z.boolean().optional(), completed: z.boolean().optional(),
}).strict().refine(value => !value.startDate || !value.endDate || value.startDate <= value.endDate, { message: "Filter deadline must be on or after its start date." });
export const preferencesPatchSchema = z.object({
  language: z.string().max(80).refine(value => { try { return Intl.getCanonicalLocales(value).length === 1; } catch { return false; } }).optional(), literalQuotedText: z.boolean().optional(),
  showCompletedTasks: z.boolean().optional(), hideProjectsWithoutCurrentTasks: z.boolean().optional(),
  theme: z.enum(["light", "dark", "system"]).optional(), sidebarCollapsed: z.boolean().optional(),
  lastView: z.string().min(1).max(256).optional(), notificationPermissionAsked: z.boolean().optional(),
}).strict();
export const notionMappingSchema = z.object({
  completionProperty: z.string().min(1).max(256).optional(), completionValue: z.string().min(1).max(256).optional(), reopenValue: z.string().min(1).max(256).optional(),
  taskTitleProperty: z.string().min(1).max(256).optional(), taskDateProperty: z.string().min(1).max(256).optional(),
  taskAreaProperty: z.string().min(1).max(256).optional(), taskProjectProperty: z.string().min(1).max(256).optional(), taskHighlightProperty: z.string().min(1).max(256).optional(),
  projectTitleProperty: z.string().min(1).max(256).optional(), projectAreaProperty: z.string().min(1).max(256).optional(), areaTitleProperty: z.string().min(1).max(256).optional(),
}).strict();
export const draftSchema = z.object({
  id: idSchema.optional(), input: z.string().max(10000), title: z.string().max(2000),
  areaId: idSchema.nullable().default(null), projectId: idSchema.nullable().default(null),
  dates: datesSchema.default({ start: null, end: null }), tags: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
  priority: prioritySchema.default("none"), recurrenceRule: recurrenceSchema.nullable().default(null),
  source: z.enum(["quick-add", "github", "contact"]).default("quick-add"), externalId: z.string().max(512).nullable().default(null), externalUrl: httpUrlSchema.nullable().default(null),
}).strict();
const withEntity = { entityType: entityTypeSchema, entityId: idSchema };
export const localMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("saveNote"), ...withEntity, content: z.string().max(500_000) }).strict(),
  z.object({ action: z.literal("deleteNote"), ...withEntity }).strict(),
  z.object({ action: z.literal("addLink"), ...withEntity, label: z.string().trim().max(256), url: httpUrlSchema }).strict(),
  z.object({ action: z.literal("deleteLink"), id: idSchema }).strict(),
  z.object({ action: z.literal("updateLink"), id: idSchema, label: z.string().trim().max(256), url: httpUrlSchema }).strict(),
  z.object({ action: z.literal("setTaskMetadata"), taskId: idSchema, patch: metadataPatchSchema }).strict(),
  z.object({ action: z.literal("setTaskTags"), taskId: idSchema, tags: z.array(z.string().trim().min(1).max(64)).max(50) }).strict(),
  z.object({ action: z.literal("saveFilter"), id: idSchema.optional(), name: z.string().trim().min(1).max(64), criteria: filterCriteriaSchema }).strict(),
  z.object({ action: z.literal("deleteFilter"), id: idSchema }).strict(),
  z.object({ action: z.literal("saveAlias"), id: idSchema.optional(), entityType: z.enum(["project", "area"]), entityId: idSchema, alias: z.string().trim().min(1).max(128) }).strict(),
  z.object({ action: z.literal("deleteAlias"), id: idSchema }).strict(),
  z.object({ action: z.literal("saveIntegration"), projectId: idSchema, repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).max(256) }).strict(),
  z.object({ action: z.literal("deleteIntegration"), id: idSchema }).strict(),
  z.object({ action: z.literal("setPreferences"), patch: preferencesPatchSchema }).strict(),
  z.object({ action: z.literal("setNotionMapping"), mapping: notionMappingSchema }).strict(),
  z.object({ action: z.literal("saveDraft"), draft: draftSchema }).strict(),
  z.object({ action: z.literal("deleteDraft"), id: idSchema }).strict(),
  z.object({ action: z.literal("linkExternal"), source: z.enum(["github", "contact"]), externalId: z.string().min(1).max(512), taskId: idSchema, url: httpUrlSchema.nullable().default(null) }).strict(),
  z.object({ action: z.literal("unlinkExternal"), id: idSchema }).strict(),
]);
export type LocalMutation = z.infer<typeof localMutationSchema>;
