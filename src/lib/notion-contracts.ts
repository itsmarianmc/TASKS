import { z } from "zod";
import { taskInputSchema, metadataPatchSchema, httpUrlSchema, idSchema } from "./schemas";
import type { Area, Diagnostic, Graph, Project, Task, LocalSnapshot } from "./types";

export interface NotionProperty { id: string; name: string; type: string; options: { id: string; name: string; group: string | null }[] }
export interface NotionSchemaResponse {
  configured: boolean; apiVersion: string; diagnostics: Diagnostic[];
  properties: { tasks: NotionProperty[]; projects: NotionProperty[]; areas: NotionProperty[] };
  completionCandidates: string[];
  completion: { property: string; type: "checkbox" | "status"; completedValue: string | null; reopenValue: string | null; completedValues: string[]; enabled: boolean } | null;
}
export interface NotionGraphResponse { graph: Graph; diagnostics: Diagnostic[]; completionEnabled: boolean }
export interface NotionGraphDelta {
  fromRevision: string; revision: string;
  areas: Area[]; projects: Project[]; tasks: Task[];
  deletedAreaIds: string[]; deletedProjectIds: string[]; deletedTaskIds: string[];
}
export interface NotionGraphCacheSnapshot { response: NotionGraphResponse; cursor: string; lastFullSyncAt: string | null; history?: NotionGraphDelta[] }
export type NotionGraphSyncResponse =
  | { mode: "snapshot"; response: NotionGraphResponse }
  | { mode: "delta"; revision: string; areas: Area[]; projects: Project[]; tasks: Task[]; deletedAreaIds: string[]; deletedProjectIds: string[]; deletedTaskIds: string[]; diagnostics: Diagnostic[]; completionEnabled: boolean };
export const taskCreateSchema = z.object({
  task: taskInputSchema,
  draftId: idSchema.optional(),
  metadata: metadataPatchSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  source: z.object({ source: z.enum(["github", "contact"]), externalId: z.string().min(1).max(512), url: httpUrlSchema.nullable().default(null) }).strict().optional(),
}).strict();
export const taskPatchSchema = z.object({
  task: taskInputSchema.partial().optional(), completed: z.boolean().optional(),
}).strict().refine(value => value.completed !== undefined || (value.task && Object.keys(value.task).length > 0), { message: "Supply task changes or completion." });
export type TaskCreate = z.infer<typeof taskCreateSchema>;
export const taskReconcileSchema = z.object({ taskId: idSchema, inspected: z.literal(true), draftId: idSchema.optional(), source: taskCreateSchema.shape.source }).strict().refine(value => !!value.draftId || !!value.source, { message: "Supply the original draft or external source." });
export type TaskReconcile = z.infer<typeof taskReconcileSchema>;
export type TaskPatch = z.infer<typeof taskPatchSchema>;
export interface TaskMutationResponse { task: Task; nextTask?: Task; warnings: string[]; snapshot?: LocalSnapshot; existing?: boolean }
