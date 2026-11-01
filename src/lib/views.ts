import type { Graph, LocalSnapshot, Preferences, Task, TaskMetadata } from "./types";
import { calendarToday, addCalendarDays, intervalOverlaps } from "./calendar";
import { projectContext } from "./view-context";
export { calendarToday } from "./calendar";
export type ViewId = string;
export const mainViews = [
  { id: "overview", label: "Overview", symbol: "≡" },
  { id: "inbox", label: "Inbox", symbol: "◇" },
  { id: "today", label: "Today", symbol: "◉" },
  { id: "next", label: "Next 7 days", symbol: "▦" },
  { id: "upcoming", label: "Upcoming", symbol: "↗" },
  { id: "anytime", label: "Anytime", symbol: "○" },
  { id: "someday", label: "Someday", symbol: "☾" },
] as const;
export function isOverdue(task: Task, today: string): boolean {
  return !task.completed && !!task.dates.end && task.dates.end < today;
}

export function sortTasks(tasks: Task[], local: LocalSnapshot, today: string): Task[] {
  const metadata = new Map(local.metadata.map(value => [value.taskId, value]));
  const priority = { none: 0, low: 1, medium: 2, high: 3, urgent: 4 };
  return [...tasks].sort((a, b) =>
    Number(a.completed) - Number(b.completed) ||
    Number(isOverdue(b, today)) - Number(isOverdue(a, today)) ||
    Number(b.highlight) - Number(a.highlight) ||
    priority[metadata.get(b.id)?.priority ?? "none"] - priority[metadata.get(a.id)?.priority ?? "none"] ||
    (a.dates.end ?? "9999-12-31").localeCompare(b.dates.end ?? "9999-12-31") ||
    (a.dates.start ?? "9999-12-31").localeCompare(b.dates.start ?? "9999-12-31") ||
    a.title.localeCompare(b.title, "en") || a.id.localeCompare(b.id),
  );
}
export const RECENT_COMPLETED_DAYS = 7;
export const matchesToday = (task: Task, today: string) => !!task.dates.start && task.dates.start <= today && (!task.dates.end || task.dates.end >= today);
export const matchesNext7Days = (task: Task, today: string) => intervalOverlaps(task.dates.start, task.dates.end, today, addCalendarDays(today, 7));
export const matchesUpcoming = (task: Task, today: string) => !!(task.dates.start ?? task.dates.end) && (task.dates.start ?? task.dates.end)! > addCalendarDays(today, 7);
export const matchesProject = (task: Task, projectId: string, areaId?: string) => task.projectId === projectId && (!areaId || task.areaId === areaId);
export const matchesArea = (task: Task, areaId: string) => task.areaId === areaId;
export const matchesAnytime = (task: Task) => !task.dates.end;
export const matchesSomeday = (_task: Task, metadata?: TaskMetadata) => !!metadata?.someday;
export function isRecentCompleted(task: Task, today: string, metadata?: TaskMetadata): boolean {
  const timestamp = task.completedAt ?? metadata?.completedAt;
  if (!task.completed || !timestamp || !Number.isFinite(Date.parse(timestamp))) return false;
  const completed = calendarToday("Europe/Berlin", new Date(timestamp));
  return completed >= addCalendarDays(today, -RECENT_COMPLETED_DAYS) && completed <= today;
}
export function shouldDisplayTask(task: Task, view: ViewId, preferences: Preferences, local: LocalSnapshot, today: string): boolean {
  const meta = local.metadata.find(value => value.taskId === task.id);
  const criteria = view.startsWith("filter:") ? local.filters.find(filter => filter.id === view.slice(7))?.criteria : undefined;
  const explicitCompletion = criteria?.completed;
  if (task.completed && explicitCompletion !== true && preferences.showCompletedTasks === false) return false;
  if (explicitCompletion !== undefined && explicitCompletion !== task.completed) return false;
  const context = projectContext(view);
  const temporal = ["today", "next", "upcoming"].includes(view) || !!(criteria?.startDate || criteria?.endDate);
  // Explicit completed filters are a deliberate history query. Unbounded ordinary lists are recent only.
  if (task.completed && !temporal && explicitCompletion !== true && view !== "overview" && !isRecentCompleted(task, today, meta)) return false;
  if (context) return matchesProject(task, context.projectId, context.areaId);
  if (view.startsWith("area:")) return matchesArea(task, view.slice(5));
  if (view.startsWith("tag:")) return local.taskTags.some(tag => tag.taskId === task.id && tag.tagId === view.slice(4));
  if (view.startsWith("filter:")) {
    if (!criteria) return false;
    return (!criteria.areaId || matchesArea(task, criteria.areaId)) &&
      (!criteria.projectId || matchesProject(task, criteria.projectId)) &&
      (criteria.highlight === undefined || criteria.highlight === task.highlight) &&
      (criteria.someday === undefined || criteria.someday === !!meta?.someday) &&
      (!criteria.priority || criteria.priority === (meta?.priority ?? "none")) &&
      (!(criteria.startDate || criteria.endDate) || intervalOverlaps(task.dates.start, task.dates.end, criteria.startDate ?? "0100-01-01", criteria.endDate ?? "9999-12-31")) &&
      (!criteria.tagIds?.length || criteria.tagIds.every(id => local.taskTags.some(tag => tag.taskId === task.id && tag.tagId === id)));
  }
  if (view === "someday") return matchesSomeday(task, meta);
  if (meta?.someday) return false;
  // Retain the existing open overdue queue; completed tasks must still overlap Today.
  if (view === "today") return matchesToday(task, today) || isOverdue(task, today);
  if (view === "next") return matchesNext7Days(task, today);
  if (view === "upcoming") return matchesUpcoming(task, today);
  if (view === "anytime") return matchesAnytime(task);
  if (view === "highlight") return task.highlight;
  if (view === "inbox") return !task.areaId || !task.projectId;
  if (view === "overview" && task.completed) return matchesToday(task, today) || matchesNext7Days(task, today) || matchesUpcoming(task, today) || (!task.dates.start && !task.dates.end && isRecentCompleted(task, today, meta));
  return true;
}
export function tasksForView(view: ViewId, graph: Graph, local: LocalSnapshot, today: string): Task[] {
  return sortTasks(graph.tasks.filter(task => shouldDisplayTask(task, view, local.preferences, local, today)), local, today);
}
export function dailyHighlights(graph: Graph, local: LocalSnapshot, today: string): Task[] {
  return tasksForView("today", graph, local, today).filter(task => task.highlight && !task.completed);
}
export interface TaskSection { label: string; items: Task[]; collapsed?: boolean }
export function taskSections(view: ViewId, graph: Graph, local: LocalSnapshot, today: string): TaskSection[] {
  const visible = tasksForView(view, graph, local, today);
  const tasks = visible.filter(task => !task.completed);
  const completed: TaskSection = { label: "completed", items: visible.filter(task => task.completed) };
  const someday = new Set(local.metadata.filter(item => item.someday).map(item => item.taskId));
  let sections: TaskSection[];
  if (view.startsWith("area:") || view.startsWith("project:") || view.startsWith("tag:")) {
    sections = [{ label: "active", items: tasks.filter(task => !someday.has(task.id)) }, { label: "someday", items: tasks.filter(task => someday.has(task.id)), collapsed: true }];
  } else if (view === "overview" || view === "today") {
    const current = new Set(tasksForView("today", graph, local, today).map(task => task.id));
    sections = [
      { label: "overdue", items: tasks.filter(task => isOverdue(task, today)) },
      { label: "daily highlight", items: tasks.filter(task => current.has(task.id) && task.highlight && !isOverdue(task, today)) },
      { label: "today", items: tasks.filter(task => current.has(task.id) && !task.highlight && !isOverdue(task, today)) },
      ...(view === "overview" ? [
        { label: "inbox", items: tasks.filter(task => !current.has(task.id) && (!task.projectId || !task.areaId)) },
        { label: "upcoming", items: tasks.filter(task => !current.has(task.id) && task.projectId && task.areaId && !!(task.dates.start ?? task.dates.end)) },
        { label: "unscheduled", items: tasks.filter(task => !current.has(task.id) && task.projectId && task.areaId && !task.dates.start && !task.dates.end) },
      ] : []),
    ];
  } else if (["upcoming", "next", "anytime", "someday"].includes(view)) {
    const groups = new Map<string, Task[]>();
    for (const task of tasks) {
      const date = view === "next" && (!task.dates.start || task.dates.start <= today) ? today : (task.dates.start ?? task.dates.end)!;
      const label = view === "upcoming" ? date.slice(0, 7) : view === "next" ? date : [graph.areas.find(area => area.id === task.areaId)?.name, graph.projects.find(project => project.id === task.projectId)?.name].filter(Boolean).join(" / ") || "unfiled";
      groups.set(label, [...(groups.get(label) ?? []), task]);
    }
    sections = [...groups].map(([label, items]) => ({ label, items }));
    if (view === "next" || view === "upcoming") sections.sort((a, b) => a.label.localeCompare(b.label));
  } else sections = [{ label: "tasks", items: tasks }];
  return [...sections, completed].filter(section => section.items.length);
}
export function sectionTitle(label: string, locale = "en-GB"): string {
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(label)) return new Intl.DateTimeFormat(locale, label.length === 7 ? { month: "long", year: "numeric", timeZone: "UTC" } : { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${label.length === 7 ? `${label}-01` : label}T12:00:00Z`)).toLowerCase();
  return label === "active" ? "tasks" : label;
}
export function viewTaskCount(view: ViewId, graph: Graph, local: LocalSnapshot, today: string): number {
  const tasks = tasksForView(view, graph, local, today);
  if (view.startsWith("filter:") && local.filters.find(filter => filter.id === view.slice(7))?.criteria.completed === true) return tasks.length;
  const entity = view.startsWith("area:") || view.startsWith("project:") || view.startsWith("tag:");
  return tasks.filter(task => !task.completed && (!entity || !local.metadata.find(item => item.taskId === task.id)?.someday)).length;
}
export function viewTitle(view: ViewId, graph: Graph, local: LocalSnapshot, translate: (text: string) => string = value => value) {
  return (
    (mainViews.find((item) => item.id === view)?.label ? translate(mainViews.find((item) => item.id === view)!.label) : undefined) ??
    (view.startsWith("area:")
      ? graph.areas.find((area) => area.id === view.slice(5))?.name
      : view.startsWith("project:")
        ? graph.projects.find((project) => project.id === projectContext(view)?.projectId)?.name
        : view.startsWith("tag:")
          ? `[${local.tags.find((tag) => tag.id === view.slice(4))?.name ?? translate("tag")}]`
          : view.startsWith("filter:")
            ? local.filters.find((filter) => filter.id === view.slice(7))?.name
            : view === "github"
              ? translate("GitHub")
              : view === "contact"
                ? translate("Contact")
                : translate("Settings")) ??
    translate("List unavailable")
  );
}
