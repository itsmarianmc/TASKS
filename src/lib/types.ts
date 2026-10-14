/** Browser-safe application contracts. Core task fields are sourced exclusively from Notion. */
export type EntityType = "task" | "project" | "area";
export interface EntityRef { type: EntityType; id: string }
export type Priority = "none" | "low" | "medium" | "high" | "urgent";
export type ISODate = string;
export interface DateRange { start: ISODate | null; end: ISODate | null }
export interface Area { id: string; name: string; type: string | null; url: string; projectIds: string[] }
export interface Project { id: string; name: string; areaIds: string[]; status: string | null; priority: string | null; dates: DateRange; url: string }
export interface Task {
  id: string; title: string; areaId: string | null; projectId: string | null;
  dates: DateRange; highlight: boolean; completed: boolean; url: string;
  createdAt: string; updatedAt: string;
  completedAt?: string | null;
  clientKey?: string;
  syncState?: "creating";
}
export interface TaskInput { title: string; areaId: string; projectId: string; dates: DateRange; highlight?: boolean }
export interface RecurrenceRule { frequency: "day" | "week" | "month" | "year"; interval: number }
export interface TaskMetadata {
  taskId: string; priority: Priority; recurrenceRule: RecurrenceRule | null;
  reminderAt: string | null; reminderDismissedAt: string | null; someday: boolean;
  completedAt?: string | null;
  createdAt: string; updatedAt: string;
}
export interface Graph { areas: Area[]; projects: Project[]; tasks: Task[]; syncedAt: string | null }
export type ServiceState = "ok" | "disabled" | "error" | "unavailable";
export interface Diagnostic { source: "notion" | "github" | "contact" | "localDatabase" | "llm"; status: ServiceState; message: string; details?: string[]; checkedAt?: string }
export interface Note { id: string; entityType: EntityType; entityId: string; content: string; createdAt: string; updatedAt: string; unsaved?: boolean }
export interface Attachment { id: string; entityType: EntityType; entityId: string; name: string; mimeType: string; size: number; createdAt: string; clientKey?: string; uploadState?: "queued" | "uploading" | "failed" }
export interface EntityLink { id: string; entityType: EntityType; entityId: string; label: string; url: string; createdAt: string }
export interface Tag { id: string; name: string; color: string | null }
export interface TaskTag { taskId: string; tagId: string }
export interface ParserAlias { id: string; entityType: "project" | "area"; entityId: string; alias: string }
export interface FilterCriteria {
  areaId?: string; projectId?: string; tagIds?: string[]; priority?: Priority;
  startDate?: ISODate; endDate?: ISODate; highlight?: boolean; someday?: boolean; completed?: boolean;
}
export interface SavedFilter { id: string; name: string; criteria: FilterCriteria; createdAt: string; updatedAt: string }
export interface ProjectIntegration { id: string; projectId: string; source: "github"; repository: string; createdAt: string }
export interface ExternalItemLink { id: string; source: "github" | "contact"; externalId: string; taskId: string; url: string | null; createdAt: string }
export interface InboxDraft {
  id: string; input: string; title: string; areaId: string | null; projectId: string | null;
  dates: DateRange; tags: string[]; priority: Priority; recurrenceRule: RecurrenceRule | null;
  source: "quick-add" | "github" | "contact"; externalId: string | null; externalUrl: string | null;
  createdAt: string; updatedAt: string;
}
export type Theme = "light" | "dark" | "system";
export interface Preferences { theme: Theme; sidebarCollapsed: boolean; lastView: string; notificationPermissionAsked: boolean; showCompletedTasks?: boolean; hideProjectsWithoutCurrentTasks?: boolean }
export interface NotionMapping {
  completionProperty?: string; completionValue?: string; reopenValue?: string;
  taskTitleProperty?: string; taskDateProperty?: string; taskAreaProperty?: string; taskProjectProperty?: string; taskHighlightProperty?: string;
  projectTitleProperty?: string; projectAreaProperty?: string; areaTitleProperty?: string;
}
export interface LocalSnapshot {
  metadata: TaskMetadata[]; notes: Note[]; attachments: Attachment[]; links: EntityLink[];
  tags: Tag[]; taskTags: TaskTag[]; aliases: ParserAlias[]; filters: SavedFilter[];
  integrations: ProjectIntegration[]; externalLinks: ExternalItemLink[]; drafts: InboxDraft[];
  preferences: Preferences; notionMapping: NotionMapping;
}
export interface ParseContext { projectId?: string; areaId?: string; today?: ISODate; timezone?: string }
export interface ParseResult {
  input: string; title: string; projectId: string | null; areaId: string | null; dates: DateRange;
  tags: string[]; priority: Priority; recurrenceRule: RecurrenceRule | null; confidence: number;
  warnings: string[]; valid: boolean; needsResolution: boolean;
}
export interface ApiErrorBody { error: { code: string; message: string; correlationId: string; details?: unknown } }
