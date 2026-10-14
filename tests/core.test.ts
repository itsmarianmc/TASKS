import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api-client";
import { classifyCreateFailure, selectProject, validateTaskFields, valueToInput, type TaskFieldsValue } from "@/lib/task-editor";
import { taskSections, viewTaskCount } from "@/lib/views";
import { parseQuickAdd } from "@/lib/parser";
import { createTaskService } from "@/lib/server/task-service";
import { createRepository } from "@/lib/server/repository";
import { openDatabase, type LocalDatabase } from "@/lib/server/db";
import type { Graph, LocalSnapshot, Task, TaskInput } from "@/lib/types";
const today = "2026-10-03";
const graph: Graph = { syncedAt: null, areas: [{ id: "homework", name: "Homework", type: "School", url: "", projectIds: ["english", "multi"] }, { id: "work", name: "Work", type: null, url: "", projectIds: ["multi"] }], projects: [{ id: "english", name: "English", areaIds: ["homework"], status: null, priority: null, dates: { start: null, end: null }, url: "" }, { id: "multi", name: "Shared", areaIds: ["homework", "work"], status: null, priority: null, dates: { start: null, end: null }, url: "" }], tasks: [] };
const value: TaskFieldsValue = { title: "Presentation", projectId: "english", areaId: "homework", dates: { start: today, end: "2026-10-09" }, highlight: false, tags: ["school"], priority: "high", recurrenceRule: { frequency: "week", interval: 2 } };
const local: LocalSnapshot = { metadata: [], notes: [], attachments: [], links: [], tags: [], taskTags: [], aliases: [], filters: [], integrations: [], externalLinks: [], drafts: [], preferences: { theme: "system", sidebarCollapsed: false, lastView: "today", notificationPermissionAsked: false }, notionMapping: {} };
const task = (id: string, start: string | null, end: string | null, patch: Partial<Task> = {}): Task => ({ id, title: id, projectId: "english", areaId: "homework", dates: { start, end }, highlight: false, completed: false, url: "https://notion.so/task", createdAt: "", updatedAt: "", ...patch });
const databases: LocalDatabase[] = [];
afterEach(() => databases.splice(0).forEach(db => db.sqlite.close()));

describe("Core composition and view decisions", () => {
  it("shows concise field warnings without technical schema paths or duplicate assignments", () => {
    const warnings = validateTaskFields({ ...value, title: "", areaId: null, projectId: null, dates: { start: "invalid", end: null } }, graph);
    expect(warnings).toEqual(["Enter a title with 1–2000 characters.", "Choose a valid calendar date.", "Choose an area.", "Choose a project."]);
    expect(warnings.join(" ")).not.toMatch(/areaId|projectId|dates\.|Invalid input/);
  });
  it("requires available, compatible assignments and roundtrippable dates", () => {
    expect(validateTaskFields(value, graph)).toEqual([]);
    expect(validateTaskFields({ ...value, areaId: "work" }, graph).join(" ")).toContain("does not belong");
    expect(validateTaskFields({ ...value, projectId: "deleted" }, graph)).toContain("Choose a project.");
    expect(validateTaskFields({ ...value, dates: { start: null, end: today } }, graph).join(" ")).toContain("needs a start");
    expect(validateTaskFields({ ...value, dates: { start: today, end: "2026-10-02" } }, graph).join(" ")).toContain("Deadline");
    expect(validateTaskFields({ ...value, dates: { start: null, end: null } }, graph)).toEqual([]);
  });
  it("infers a single-area project and retains a conflicting multi-area choice for correction", () => {
    expect(selectProject({ ...value, areaId: "work" }, "english", graph).areaId).toBe("homework");
    expect(selectProject({ ...value, areaId: null }, "multi", graph).areaId).toBeNull();
    expect(selectProject({ ...value, areaId: "missing" }, "multi", graph).areaId).toBe("missing");
  });
  it("places future highlights in upcoming and partitions overview without duplicating tasks", () => {
    const data = { ...graph, tasks: [task("past", "2026-10-01", "2026-10-02", { highlight: true }), task("now", today, "2026-10-08", { highlight: true }), task("later", "2026-10-18", "2026-10-20", { highlight: true }), task("undated", null, null), task("missing", null, null, { projectId: null })] };
    const sections = taskSections("overview", data, local, today);
    expect(sections.find(section => section.label === "daily highlight")?.items.map(task => task.id)).toEqual(["now"]);
    expect(sections.find(section => section.label === "upcoming")?.items.map(task => task.id)).toEqual(["later"]);
    const ids = sections.flatMap(section => section.items.map(task => task.id)); expect(ids.length).toBe(new Set(ids).size); expect(ids).toHaveLength(data.tasks.length);
  });
  it("groups upcoming calendar months, sorting sections chronologically", () => {
    const data = { ...graph, tasks: [task("a", "2026-11-03", null), task("b", "2026-10-18", "2026-10-20"), task("c", "2026-10-18", null)] };
    const sections = taskSections("upcoming", data, local, today);
    expect(sections.map(section => section.label)).toEqual(["2026-10", "2026-11"]); expect(sections[0].items).toHaveLength(2);
  });
  it("keeps entity completed/Someday reachable while excluding them from active counts", () => {
    const data = { ...graph, tasks: [task("active", today, null), task("done", today, null, { completed: true, completedAt: "2026-10-03T12:00:00Z" }), task("later", today, null)] };
    const snapshot: LocalSnapshot = { ...local, metadata: [{ taskId: "later", priority: "none", recurrenceRule: null, reminderAt: null, reminderDismissedAt: null, someday: true, createdAt: "", updatedAt: "" }] };
    const sections = taskSections("project:english", data, snapshot, today);
    expect(sections.map(section => [section.label, section.collapsed])).toEqual([["active", undefined], ["someday", true], ["completed", undefined]]);
    expect(viewTaskCount("project:english", data, snapshot, today)).toBe(1);
    expect(viewTaskCount("someday", data, snapshot, today)).toBe(1);
  });
  it("sends deterministic parser results through task validation and the actual SQLite task service", async () => {
    const parsed = parseQuickAdd("Make presentation #English @Homework tomorrow [school] !! every 2 weeks", graph, [], { today, timezone: "Europe/Berlin" });
    expect(parsed.valid).toBe(true);
    const fields = { ...parsed, highlight: false }; expect(validateTaskFields(fields, graph)).toEqual([]);
    const db = openDatabase(":memory:"); databases.push(db);
    const createTask = vi.fn(async (input: TaskInput) => ({ ...task("created", today, null), ...input, highlight: input.highlight ?? false }));
    const adapter = { createTask, updateTask: vi.fn(), getTask: vi.fn(), deleteTask: vi.fn(), readGraph: vi.fn(), publicSchema: vi.fn(), invalidate: vi.fn() };
    const result = await createTaskService(adapter, createRepository(db)).create({ task: valueToInput(fields), tags: parsed.tags, metadata: { priority: parsed.priority, recurrenceRule: parsed.recurrenceRule } });
    expect(result.task).toMatchObject({ title: "Make presentation", areaId: "homework", projectId: "english", dates: { start: today, end: "2026-10-04" } });
    expect(result.snapshot?.metadata[0]).toMatchObject({ priority: "high", recurrenceRule: { frequency: "week", interval: 2 } }); expect(result.snapshot?.tags[0].name).toBe("school");
  });
});

describe("Client confirmed/uncertain create distinction", () => {
  it.each([
    new ApiClientError("Disabled", 503, "NOTION_DISABLED"),
    new ApiClientError("Graph failed", 502, "NOTION_UNAVAILABLE", undefined, { operation: "graph.paginate", upstreamStatus: 503 }),
    new ApiClientError("Rejected", 502, "NOTION_UNAVAILABLE", undefined, { operation: "task.create", upstreamStatus: 400 }),
    new ApiClientError("Invalid", 422, "RELATION_CONFLICT"),
  ])("allows correction/retry after definite preflight or rejected create %#", error => expect(classifyCreateFailure(error).uncertain).toBe(false));
  it.each([new TypeError("Network failed"), new ApiClientError("Unknown", 502, "NOTION_UNAVAILABLE", undefined, { operation: "task.create" }), new ApiClientError("Pending", 409, "CONVERSION_UNCERTAIN")])("blocks replay after an uncertain remote result %#", error => expect(classifyCreateFailure(error).uncertain).toBe(true));
  it("retains a known created ID from a failed response mapping", () => expect(classifyCreateFailure(new ApiClientError("Created", 502, "NOTION_WRITE_OUTCOME", undefined, { operation: "task.create", taskId: "known-1" }))).toEqual({ uncertain: true, taskId: "known-1" }));
});
