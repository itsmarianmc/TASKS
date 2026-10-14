import { describe, expect, it } from "vitest";
import { captureContext, projectContext, projectResourceId, projectView, viewFromParams, viewUrl } from "@/lib/view-context";
import { tasksForView, taskSections, viewTaskCount, viewTitle } from "@/lib/views";
import { parseQuickAdd } from "@/lib/parser";
import type { Graph, LocalSnapshot, Task } from "@/lib/types";

const graph: Graph = {
  syncedAt: null,
  areas: ["books", "presentations"].map((id, index) => ({ id, name: ["Bücher", "Präsentationen"][index], type: null, projectIds: ["religion"], url: "" })),
  projects: [{ id: "religion", name: "Religion", areaIds: ["books", "presentations"], dates: { start: null, end: null }, status: null, priority: null, url: "" }],
  tasks: ["book-1", "book-2", "slides", "later", "done"].map((id): Task => ({ id, title: id, areaId: id.startsWith("book") || id === "later" ? "books" : "presentations", projectId: "religion", dates: { start: null, end: null }, highlight: false, completed: id === "done", completedAt: id === "done" ? "2026-10-04T12:00:00Z" : null, url: "", createdAt: "", updatedAt: "" })),
};
const local: LocalSnapshot = { metadata: [{ taskId: "later", priority: "none", recurrenceRule: null, someday: true, reminderAt: null, reminderDismissedAt: null, createdAt: "", updatedAt: "" }], notes: [], links: [], attachments: [], drafts: [], tags: [], taskTags: [], aliases: [], filters: [], integrations: [], externalLinks: [], preferences: { theme: "dark", lastView: "today", sidebarCollapsed: false, notificationPermissionAsked: false }, notionMapping: {} };
const today = "2026-10-04";
describe("Area + Project view identity", () => {
  it("distinguishes the two Religion sidebar entries and counts only their own active tasks", () => {
    const books = projectView("religion", "books"), slides = projectView("religion", "presentations");
    expect(books).not.toBe(slides);
    expect(viewTaskCount(books, graph, local, today)).toBe(2);
    expect(viewTaskCount(slides, graph, local, today)).toBe(1);
    expect(tasksForView(books, graph, local, today).map(task => task.id)).toEqual(["book-1", "book-2", "later"]);
    expect(tasksForView(slides, graph, local, today).map(task => task.id)).toEqual(["slides", "done"]);
    expect(taskSections(slides, graph, local, today).find(section => section.label === "someday")).toBeUndefined();
    expect(viewTitle(books, graph, local)).toBe("Religion");
  });
  it("roundtrips context through direct URLs, preserving legacy project view strings", () => {
    const view = projectView("religion", "presentations");
    expect(viewFromParams(new URL(viewUrl(view), "https://taesks.test").searchParams)).toBe(view);
    expect(projectContext("project:religion")).toEqual({ projectId: "religion", areaId: undefined });
    expect(projectContext(projectView("project:1", "area:2"))).toEqual({ projectId: "project:1", areaId: "area:2" });
  });
  it("defaults Quick Add to both relations and allows an explicit area override", () => {
    const context = { ...captureContext(projectView("religion", "presentations"), graph), today };
    expect(parseQuickAdd("Prepare presentation until Friday", graph, [], context)).toMatchObject({ areaId: "presentations", projectId: "religion", valid: true });
    expect(parseQuickAdd("Read chapter @Bücher", graph, [], context)).toMatchObject({ areaId: "books", projectId: "religion", valid: true });
  });
  it("isolates local project resources without colliding or changing global keys", () => {
    expect(projectResourceId("religion", "books")).not.toBe(projectResourceId("religion", "presentations"));
    expect(projectResourceId("c", "a:b")).not.toBe(projectResourceId("b:c", "a"));
    expect(projectResourceId("religion", "books")).not.toBe("religion");
  });
});
