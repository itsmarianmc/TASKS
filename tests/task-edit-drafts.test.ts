import { describe, expect, it, vi, afterEach } from "vitest";
import { coreFields, readTaskEdit, reconcileTaskEdit, storeTaskEdit } from "../src/lib/task-edit-drafts";
import type { Task } from "../src/lib/types";
const task: Task = { id: "task", title: "A", areaId: "area", projectId: "project", dates: { start: null, end: null }, highlight: false, completed: false, url: "", createdAt: "", updatedAt: "" };
afterEach(() => vi.unstubAllGlobals());
function storage() { const entries = new Map<string, string>(); vi.stubGlobal("localStorage", { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key) }); return entries; }
describe("durable task editor values", () => {
  it("restores failed title/date edits after reopening", () => { storage(); storeTaskEdit("task", task, { ...task, title: "B", dates: { start: "2026-10-04", end: "2026-10-05" } }); expect(readTaskEdit("task", task)).toMatchObject({ title: "B", dates: { start: "2026-10-04", end: "2026-10-05" } }); });
  it("never restores stale untouched fields over a changed upstream title", () => { storage(); storeTaskEdit("task", task, { ...task, dates: { start: "2026-10-04", end: null } }); expect(readTaskEdit("task", { ...task, title: "Upstream" })).toMatchObject({ title: "Upstream", dates: { start: "2026-10-04", end: null } }); });
  it("a B response preserves later C text, and a C response clears the draft", () => { const entries = storage(); const b = { ...task, title: "B" }, c = { ...task, title: "C" }; storeTaskEdit("task", task, c); reconcileTaskEdit("task", b, b); expect(readTaskEdit("task", b).title).toBe("C"); reconcileTaskEdit("task", c, c); expect(entries.has("task")).toBe(false); expect(coreFields(c).title).toBe("C"); });
});
