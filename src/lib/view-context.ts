import type { Graph, ParseContext } from "./types";

/** A project row is identified by both relations, never by its display name. */
export function projectView(projectId: string, areaId?: string): string {
  return `project:${encodeURIComponent(projectId)}${areaId ? `?area=${encodeURIComponent(areaId)}` : ""}`;
}
export function projectContext(view: string): { projectId: string; areaId?: string } | null {
  if (!view.startsWith("project:")) return null;
  const [id, query] = view.slice(8).split("?");
  try { return { projectId: decodeURIComponent(id), areaId: new URLSearchParams(query).get("area") || undefined }; }
  catch { return null; }
}
export function captureContext(view: string, graph: Graph): ParseContext {
  const context = projectContext(view);
  if (context) {
    const project = graph.projects.find(value => value.id === context.projectId);
    return { projectId: context.projectId, areaId: context.areaId ?? (project?.areaIds.length === 1 ? project.areaIds[0] : undefined) };
  }
  return view.startsWith("area:") ? { areaId: view.slice(5) } : {};
}
export function viewUrl(view: string): string {
  const context = projectContext(view);
  const params = new URLSearchParams(context ? { view: "project", project: context.projectId, ...(context.areaId ? { area: context.areaId } : {}) } : { view });
  return `/?${params}`;
}
export function viewFromParams(params: URLSearchParams): string | undefined {
  const view = params.get("view");
  return view === "project" && params.get("project") ? projectView(params.get("project")!, params.get("area") ?? undefined) : view || undefined;
}
/** Length-prefixed, schema-safe key; leaves existing global project resources intact. */
export function projectResourceId(projectId: string, areaId: string): string {
  return `ctx:${areaId.length}:${areaId}:${projectId}`;
}
