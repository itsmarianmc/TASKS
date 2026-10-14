import { taskInputSchema, metadataPatchSchema } from "./schemas";
import { ApiClientError } from "./api-client";
import type { DateRange, Graph, Priority, RecurrenceRule, TaskInput } from "./types";

export interface TaskFieldsValue {
  title: string; areaId: string | null; projectId: string | null; dates: DateRange;
  highlight: boolean; tags: string[]; tagsText?: string; priority: Priority; recurrenceRule: RecurrenceRule | null;
}
/** Browser validation complements authoritative fresh relation checks on the server. */
export function validateTaskFields(value: TaskFieldsValue, graph: Graph): string[] {
  const warnings: string[] = [];
  const parsed = taskInputSchema.safeParse(valueToInput(value));
  if (!parsed.success) for (const issue of parsed.error.issues) {
    if (issue.path[0] === "title") warnings.push("Enter a title with 1–2000 characters.");
    else if (issue.path[0] === "dates") warnings.push(issue.path.length === 1 ? "Deadline must be on or after the start date." : "Choose a valid calendar date.");
  }
  const area = graph.areas.find(item => item.id === value.areaId);
  const project = graph.projects.find(item => item.id === value.projectId);
  if (!area) warnings.push("Choose an area.");
  if (!project) warnings.push("Choose a project.");
  if (area && project && !project.areaIds.includes(area.id)) warnings.push("Project does not belong to this area. Choose another project or area.");
  if (value.dates.end && !value.dates.start) warnings.push("A deadline needs a start date. Choose a start or clear both dates.");
  const metadata = metadataPatchSchema.safeParse({ priority: value.priority, recurrenceRule: value.recurrenceRule });
  if (!metadata.success) warnings.push("Choose a valid priority and repeat interval between 1 and 365.");
  if (value.tags.length > 50 || value.tags.some(tag => !tag.trim() || tag.trim().length > 64)) warnings.push("Use up to 50 tags, each with 1–64 characters.");
  return [...new Set(warnings)];
}
export function valueToInput(value: TaskFieldsValue): TaskInput {
  return { title: value.title.trim(), areaId: value.areaId ?? "", projectId: value.projectId ?? "", dates: value.dates, highlight: value.highlight };
}
export function selectProject(value: TaskFieldsValue, id: string, graph: Graph): TaskFieldsValue {
  const project = graph.projects.find(item => item.id === id);
  return { ...value, projectId: id || null, areaId: project?.areaIds.length === 1 ? project.areaIds[0] : value.areaId };
}
export function classifyCreateFailure(error: unknown): { uncertain: boolean; taskId?: string } {
  if (!(error instanceof ApiClientError)) return { uncertain: true };
  const details = error.details && typeof error.details === "object" ? error.details as { operation?: string; upstreamStatus?: number; taskId?: string } : {};
  if (error.code === "CONVERSION_UNCERTAIN") return { uncertain: true };
  if (details.taskId && typeof details.taskId === "string") return { uncertain: true, taskId: details.taskId };
  const preflight = ["NOTION_DISABLED", "NOTION_CONFIG", "NOTION_SCHEMA", "NOTION_DATA_SOURCE", "NOTION_DATE", "RELATION_UNAVAILABLE", "RELATION_CONFLICT"].includes(error.code) || (details.operation && details.operation !== "task.create");
  const rejected = details.upstreamStatus && details.upstreamStatus >= 400 && details.upstreamStatus < 500;
  return { uncertain: !(preflight || rejected || error.status < 500) };
}
