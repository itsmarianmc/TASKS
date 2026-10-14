import { describe, expect, it } from "vitest";
import { dailyHighlights, isOverdue, tasksForView } from "@/lib/views";
import type { Graph, LocalSnapshot, Task, TaskMetadata } from "@/lib/types";

const today = "2026-10-03";
const task = (id: string, start: string | null, end: string | null, patch: Partial<Task> = {}): Task => ({ id, title: id, areaId: "area", projectId: "project", dates: { start, end }, completed: false, highlight: false, url: "", createdAt: "", updatedAt: "", ...patch });
const metadata = (taskId: string, patch: Partial<TaskMetadata> = {}): TaskMetadata => ({ taskId, priority: "none", recurrenceRule: null, reminderAt: null, reminderDismissedAt: null, someday: false, createdAt: "", updatedAt: "", ...patch });
const local: LocalSnapshot = { metadata: [metadata("someday", { someday: true }), metadata("priority", { priority: "urgent" })], notes: [], attachments: [], links: [], tags: [{ id: "school", name: "school", color: null }], taskTags: [{ taskId: "interval", tagId: "school" }], aliases: [], filters: [], integrations: [], externalLinks: [], drafts: [], preferences: { theme: "system", sidebarCollapsed: false, lastView: "today", notificationPermissionAsked: false }, notionMapping: {} };
const graph: Graph = { areas: [], projects: [], syncedAt: null, tasks: [
  task("overdue", "2026-09-01", "2026-10-02"),
  task("interval", "2026-10-01", "2026-10-18"),
  task("boundary", "2026-10-10", "2026-10-12"),
  task("future", "2026-10-11", "2026-10-18"),
  task("deadline-only", null, "2026-10-20"),
  task("start-only", "2026-10-01", null),
  task("undated", null, null),
  task("highlight", today, "2026-10-08", { highlight: true }),
  task("priority", today, "2026-10-04"),
  task("completed", today, "2026-10-01", { completed: true, completedAt: "2026-10-03T12:00:00Z", highlight: true }),
  task("someday", today, "2026-10-04"),
] };
const ids = (view: string, snapshot = local) => tasksForView(view, graph, snapshot, today).map(value => value.id);

describe("single shared view selectors", () => {
  it("shows inclusive active intervals and overdue at the top of Today", () => {
    expect(ids("today")).toEqual(["overdue", "highlight", "priority", "interval", "start-only"]);
    expect(isOverdue(graph.tasks[0], today)).toBe(true);
    expect(isOverdue(graph.tasks.find(value => value.id === "completed")!, today)).toBe(false);
  });
  it("uses interval overlap including entire-window intervals and day seven", () => {
    expect(new Set(ids("next"))).toEqual(new Set(["interval", "boundary", "deadline-only", "start-only", "highlight", "priority"]));
    expect(ids("next")).not.toContain("future");
    expect(ids("next")).not.toContain("overdue");
    const enclosing: Graph = { ...graph, tasks: [task("enclosing", "2026-09-01", "2026-11-01")] };
    expect(tasksForView("next", enclosing, local, today)).toHaveLength(1);
  });
  it("shows upcoming dates after the inclusive seven-day window, including missing starts", () => expect(new Set(ids("upcoming"))).toEqual(new Set(["future", "deadline-only"])));
  it("keeps deadline-free tasks in Anytime and excludes Someday/completed", () => expect(ids("anytime")).toEqual(["start-only", "undated"]));
  it("isolates Someday from normal views", () => {
    expect(ids("someday")).toEqual(["someday"]);
    for (const view of ["overview", "today", "next", "upcoming", "anytime", "highlight"]) expect(ids(view)).not.toContain("someday");
    expect(ids("project:project")).toContain("someday");
  });
  it("uses actual Highlight and existing relation/tag IDs", () => {
    expect(ids("highlight")).toEqual(["highlight", "completed"]);
    expect(dailyHighlights(graph, local, today).map(value => value.id)).toEqual(["highlight"]);
    expect(ids("tag:school")).toEqual(["interval"]);
    expect(ids("tag:missing")).toEqual([]);
    expect(ids("area:missing")).toEqual([]);
    expect(ids("project:project").at(-1)).toBe("completed");
  });
  it("requires actual interval overlap for date filters and evaluates all criteria", () => {
    const filtered: LocalSnapshot = { ...local, filters: [{ id: "range", name: "range", createdAt: "", updatedAt: "", criteria: { startDate: today, endDate: "2026-10-10", projectId: "project", areaId: "area", completed: false, someday: false } }, { id: "tag", name: "tag", createdAt: "", updatedAt: "", criteria: { tagIds: ["school"] } }, { id: "priority", name: "priority", createdAt: "", updatedAt: "", criteria: { priority: "urgent", highlight: false } }, { id: "done", name: "done", createdAt: "", updatedAt: "", criteria: { completed: true } }] };
    expect(new Set(ids("filter:range", filtered))).toEqual(new Set(["interval", "boundary", "deadline-only", "start-only", "highlight", "priority"]));
    expect(ids("filter:tag", filtered)).toEqual(["interval"]);
    expect(ids("filter:priority", filtered)).toEqual(["priority"]);
    expect(ids("filter:done", filtered)).toEqual(["completed"]);
    expect(ids("filter:missing", filtered)).toEqual([]);
  });
  it("treats endpoints inclusively and excludes finished or not-yet-started tasks today", () => {
    const boundary: Graph = { ...graph, tasks: [task("same-day", today, today), task("end-today", "2026-10-01", today), task("starts-today", today, null), task("future-start-only", "2026-10-11", null)] };
    expect(tasksForView("today", boundary, local, today).map(value => value.id)).toEqual(["end-today", "same-day", "starts-today"]);
    expect(tasksForView("next", boundary, local, today)).toHaveLength(3);
  });
  it("retains source ordering and sorts stable tied results by title/id", () => {
    const source: Graph = { ...graph, tasks: [task("b", today, null, { title: "Same" }), task("a", today, null, { title: "Same" })] };
    expect(tasksForView("today", source, local, today).map(value => value.id)).toEqual(["a", "b"]);
    expect(source.tasks.map(value => value.id)).toEqual(["b", "a"]);
  });
});
