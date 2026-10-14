import { beforeEach, describe, expect, it, vi } from "vitest";
const methods = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), delete: vi.fn(), reconcile: vi.fn() }));
vi.mock("@/lib/server/task-service", () => ({ taskService: async () => methods }));
import { POST } from "@/app/api/tasks/route";
import { POST as RECONCILE } from "@/app/api/tasks/reconcile/route";
import { DELETE, PATCH } from "@/app/api/tasks/[id]/route";
const request = (body: unknown, method = "POST", origin = "http://localhost:3000") => new Request("http://localhost:3000/api/tasks/task-1", { method, headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); methods.create.mockResolvedValue({ task: { id: "task-1" }, warnings: [] }); methods.update.mockResolvedValue({ task: { id: "task-1", completed: true }, warnings: [] }); methods.delete.mockResolvedValue({ deleted: true }); });
describe("task HTTP mutation boundaries", () => {
  it("requires same-origin explicit inspection for linking an existing task", async () => {
    methods.reconcile.mockResolvedValue({ task: { id: "task-1" }, existing: true, warnings: [] });
    const body = { taskId: "task-1", draftId: "draft-1", inspected: true };
    expect((await RECONCILE(request(body))).status).toBe(200);
    expect((await RECONCILE(request({ ...body, inspected: false }))).status).toBe(400);
    expect((await RECONCILE(request(body, "POST", "https://foreign.example"))).status).toBe(403);
    expect(methods.reconcile).toHaveBeenCalledOnce(); expect(methods.create).not.toHaveBeenCalled();
  });
  it("validates structured create input and blocks cross-origin writes", async () => {
    const body = { task: { title: "Presentation", areaId: "area-1", projectId: "project-1", dates: { start: "2026-10-03", end: "2026-10-18" } }, tags: ["school"] };
    expect((await POST(request(body))).status).toBe(201); expect(methods.create).toHaveBeenCalledWith(body);
    expect((await POST(request(body, "POST", "https://elsewhere.example"))).status).toBe(403);
    expect((await POST(request({ task: { title: "Missing relation" } }))).status).toBe(400); expect(methods.create).toHaveBeenCalledOnce();
  });
  it("supports task edits/completion, rejects empty patches and requires deletion confirmation", async () => {
    const context = { params: Promise.resolve({ id: "task-1" }) };
    expect((await PATCH(request({ completed: true }, "PATCH"), context)).status).toBe(200);
    expect(methods.update).toHaveBeenCalledWith("task-1", { completed: true });
    expect((await PATCH(request({}, "PATCH"), context)).status).toBe(400);
    expect((await DELETE(request({ confirmed: false }, "DELETE"), context)).status).toBe(400); expect(methods.delete).not.toHaveBeenCalled();
    expect((await DELETE(request({ confirmed: true }, "DELETE"), context)).status).toBe(200); expect(methods.delete).toHaveBeenCalledWith("task-1");
  });
});
