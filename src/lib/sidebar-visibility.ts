import type { Graph, LocalSnapshot, Preferences } from "./types";
import { projectContext, projectView } from "./view-context";
import { viewTaskCount } from "./views";

export function shouldDisplayProjectInSidebar({ openTaskCount, isActive, preferences }: { openTaskCount: number; isActive: boolean; preferences: Preferences }): boolean {
  return isActive || !preferences.hideProjectsWithoutCurrentTasks || openTaskCount > 0;
}

export function sidebarAreas(graph: Graph, local: LocalSnapshot, today: string, view: string) {
  const active = projectContext(view);
  return graph.areas.map(area => ({ area, projects: graph.projects.filter(project =>
    project.areaIds.includes(area.id) && shouldDisplayProjectInSidebar({
      openTaskCount: viewTaskCount(projectView(project.id, area.id), graph, local, today),
      isActive: active?.projectId === project.id && (active.areaId === area.id || !active.areaId),
      preferences: local.preferences,
    }),
  ) })).filter(({ area, projects }) => !local.preferences.hideProjectsWithoutCurrentTasks || projects.length || view === `area:${area.id}` || active?.areaId === area.id || viewTaskCount(`area:${area.id}`, graph, local, today) > 0);
}
