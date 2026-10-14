import { describe, expect, it } from "vitest";
import { tasksForView, taskSections, viewTaskCount, isRecentCompleted } from "@/lib/views";
import { sidebarAreas } from "@/lib/sidebar-visibility";
import { projectView } from "@/lib/view-context";
import { openDatabase } from "@/lib/server/db";
import { createRepository } from "@/lib/server/repository";
import { createTaskService } from "@/lib/server/task-service";
import type { Graph, LocalSnapshot, Task } from "@/lib/types";

const today = "2026-10-04";
const task = (id: string, start: string | null, end: string | null, patch: Partial<Task> = {}): Task => ({ id, title: id, areaId: "slides", projectId: "history", dates: { start, end }, highlight: false, completed: false, createdAt: "", updatedAt: "", url: "", ...patch });
const completed = (id: string, start: string | null, end: string | null, patch: Partial<Task> = {}) => task(id, start, end, { completed: true, completedAt: "2026-10-04T10:00:00Z", ...patch });
const local: LocalSnapshot = { metadata: [], notes: [], attachments: [], links: [], tags: [{ id: "tag", name: "school", color: null }], taskTags: [], aliases: [], filters: [], integrations: [], externalLinks: [], drafts: [], preferences: { theme: "dark", sidebarCollapsed: false, lastView: "overview", notificationPermissionAsked: false, showCompletedTasks: true, hideProjectsWithoutCurrentTasks: false }, notionMapping: {} };
const graph: Graph = { tasks: [], syncedAt: null, areas: ["books", "slides"].map(id => ({ id, name: id, type: null, url: "", projectIds: ["religion", "history", "german", "physics", "math"] })), projects: ["religion", "physics", "math", "history", "german"].map(id => ({ id, name: id, areaIds: ["books", "slides"], status: null, priority: null, url: "", dates: { start: null, end: null } })) };
const ids = (view: string, tasks: Task[], snapshot = local) => tasksForView(view, { ...graph, tasks }, snapshot, today).map(task => task.id);
const hidden = { ...local, preferences: { ...local.preferences, showCompletedTasks: false } };

describe("completion visibility and scopes", () => {
  const tasks = [task("open", today, "2026-10-16"), completed("current", today, "2026-10-16"), completed("past", "2026-09-01", "2026-10-03"), completed("next", "2026-10-11", "2026-10-11"), completed("future", "2026-10-12", "2026-10-20")];
  it("keeps completed intervals in Today and rejects past and future ranges", () => expect(ids("today", tasks)).toEqual(["open", "current"]));
  it("uses inclusive seven-day interval overlap for completed tasks", () => expect(ids("next", tasks)).toEqual(["open", "next", "current"]));
  it("keeps Upcoming scoped rather than adding completed history", () => expect(ids("upcoming", tasks)).toEqual(["future"]));
  it.each(["overview", "today", "next", "upcoming", "project:history", "area:slides", "anytime", "someday", "tag:tag"])("respects the global preference in %s without changing open counts", view => {
    expect(ids(view, tasks, hidden)).not.toContain("current");
    expect(viewTaskCount(view, { ...graph, tasks }, hidden, today)).toBe(viewTaskCount(view, { ...graph, tasks }, local, today));
  });
  it("caps unbounded lists at seven calendar days, using completion rather than modification time", () => {
    const recent = completed("recent", null, null, { completedAt: "2026-09-27T22:30:00Z" });
    const old = completed("old", null, null, { completedAt: "2026-09-26T12:00:00Z", updatedAt: "2026-10-04T12:00:00Z" });
    const unknown = completed("unknown", null, null, { completedAt: null });
    for (const view of ["project:history", "area:slides", "anytime"]) expect(ids(view, [recent, old, unknown])).toEqual(["recent"]);
    expect(isRecentCompleted(completed("bad", null, null, { completedAt: "bad" }), today)).toBe(false);
  });
  it("uses a persisted local completion timestamp after reloading a source task", () => {
    const data = { ...local, metadata: [{ taskId: "local-stamp", completedAt: "2026-10-04T12:00:00Z", priority: "none" as const, someday: false, reminderAt: null, reminderDismissedAt: null, recurrenceRule: null, createdAt: "", updatedAt: "" }] };
    expect(ids("project:history", [completed("local-stamp", null, null, { completedAt: undefined })], data)).toEqual(["local-stamp"]);
  });
  it("places all completed tasks in one visible section after open tasks", () => {
    const sections = taskSections("today", { ...graph, tasks }, local, today);
    expect(sections.at(-1)).toMatchObject({ label: "completed", items: [{ id: "current" }] });
    expect(sections.flatMap(section => section.items).map(task => task.id)).toEqual(["open", "current"]);
    expect(taskSections("today", { ...graph, tasks }, hidden, today).some(section => section.label === "completed")).toBe(false);
  });
  it("lets explicit saved completion filters override the preference and history cap", () => {
    const data = { ...hidden, filters: [true, false, undefined].map((completed, index) => ({ id: `${index}`, name: "filter", criteria: { completed }, createdAt: "", updatedAt: "" })) };
    const entries = [task("open", null, null), completed("old", null, null, { completedAt: "2026-01-01T12:00:00Z" })];
    expect(ids("filter:0", entries, data)).toEqual(["old"]);
    expect(ids("filter:1", entries, data)).toEqual(["open"]);
    expect(ids("filter:2", entries, data)).toEqual(["open"]);
  });
});

describe("contextual sidebar filtering", () => {
  const tasks = [task("history", today, null), task("german", today, null, { projectId: "german" }), completed("only-done", today, null, { projectId: "religion" })];
  const filtered = { ...local, preferences: { ...local.preferences, hideProjectsWithoutCurrentTasks: true } };
  it("keeps all projects by default and only actionable entries when enabled", () => {
    expect(sidebarAreas({ ...graph, tasks }, local, today, "overview")[1].projects).toHaveLength(5);
    expect(sidebarAreas({ ...graph, tasks }, filtered, today, "overview").map(({ area, projects }) => [area.id, projects.map(project => project.id)])).toEqual([["slides", ["history", "german"]]]);
  });
  it("retains the active context at zero until the user navigates away", () => {
    const view = projectView("religion", "books");
    const tree = sidebarAreas({ ...graph, tasks }, filtered, today, view);
    expect(tree[0].area.id).toBe("books"); expect(tree[0].projects.map(project => project.id)).toEqual(["religion"]);
    expect(sidebarAreas({ ...graph, tasks }, filtered, today, "overview").some(entry => entry.area.id === "books")).toBe(false);
  });
  it("filters the same project independently in each area and leaves the source graph intact", () => {
    const source = { ...graph, tasks: [task("slides-only", today, null, { projectId: "religion" })] };
    const tree = sidebarAreas(source, filtered, today, "overview");
    expect(tree.map(entry => entry.area.id)).toEqual(["slides"]);
    expect(tree[0].projects.map(project => project.id)).toEqual(["religion"]);
    expect(source.projects).toHaveLength(5); expect(source.areas).toHaveLength(2);
  });
  it("retains the directly opened empty area", () => expect(sidebarAreas(graph, filtered, today, "area:books").map(entry => entry.area.id)).toEqual(["books"]));
});

describe("display and completion persistence", () => {
  it("merges new preference defaults without replacing existing values", async () => {
    const db = openDatabase(":memory:");
    try {
      db.sqlite.prepare("INSERT INTO app_preferences(key,value,updated_at) VALUES ('preferences',?,?)").run(JSON.stringify({ theme: "light", lastView: "area:books", sidebarCollapsed: true }), today);
      const repo = createRepository(db);
      expect(await repo.getPreferences()).toMatchObject({ theme: "light", lastView: "area:books", sidebarCollapsed: true, showCompletedTasks: true, hideProjectsWithoutCurrentTasks: false });
      await Promise.all([repo.mutate({ action: "setPreferences", patch: { showCompletedTasks: false } }), repo.mutate({ action: "setPreferences", patch: { hideProjectsWithoutCurrentTasks: true } })]);
      expect(await createRepository(db).getPreferences()).toMatchObject({ theme: "light", showCompletedTasks: false, hideProjectsWithoutCurrentTasks: true });
    } finally { db.sqlite.close(); }
  });
  it("records complete/reopen timestamps through the actual task service and database", async () => {
    const db = openDatabase(":memory:");
    try {
      const repo = createRepository(db);
      const entry = task("stamp", today, null);
      const adapter = { updateTask: async (_id: string, body: { completed?: boolean }) => ({ ...entry, completed: body.completed ?? false }) } as Parameters<typeof createTaskService>[0];
      const service = createTaskService(adapter, repo);
      const done = await service.update(entry.id, { completed: true });
      expect(done.task.completedAt).toEqual(expect.any(String));
      expect((await repo.getMetadata(entry.id)).completedAt).toBe(done.task.completedAt);
      await service.update(entry.id, { completed: false });
      expect((await repo.getMetadata(entry.id)).completedAt).toBeNull();
    } finally { db.sqlite.close(); }
  });
});
