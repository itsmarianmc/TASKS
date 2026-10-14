import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, recoverInterruptedConversions, type LocalDatabase } from "@/lib/server/db";
import { createRepository } from "@/lib/server/repository";
import { createTaskService, shiftRecurringDates } from "@/lib/server/task-service";
import { AppError } from "@/lib/server/http";
import type { Task, TaskInput } from "@/lib/types";
const databases: LocalDatabase[] = [];
const core: TaskInput = { title: "Presentation", areaId: "area-1", projectId: "project-1", dates: { start: "2026-10-03", end: "2026-10-18" }, highlight: true };
const task: Task = { ...core, id: "task-1", highlight: true, completed: false, url: "https://notion.so/task1", createdAt: "2026-10-03T12:00:00Z", updatedAt: "2026-10-03T12:00:00Z" };
const source = { source: "github" as const, externalId: "owner/repo#42", url: "https://github.com/owner/repo/issues/42" };
function setup() {
  const db = openDatabase(":memory:"); databases.push(db); const repo = createRepository(db);
  let counter = 1;
  const adapter = {
    createTask: vi.fn(async (input: TaskInput): Promise<Task> => ({ ...task, ...input, id: `task-${++counter}` })),
    updateTask: vi.fn(async (_id: string, patch: { completed?: boolean }) => ({ ...task, completed: patch.completed ?? false })),
    getTask: vi.fn(async (id: string) => ({ ...task, id })), deleteTask: vi.fn(async () => ({ deleted: true })),
    readGraph: vi.fn(), publicSchema: vi.fn(), invalidate: vi.fn(),
  };
  return { db, repo, adapter, service: createTaskService(adapter, repo) };
}
afterEach(() => { databases.splice(0).forEach(db => db.sqlite.close()); });
describe("Notion/local orchestration", () => {
  it("recovers an uncertain source through verified GET without another Notion write", async () => {
    const { repo, adapter, service } = setup(); repo.claimExternalConversion(source.source, source.externalId); repo.failExternalConversion(source.source, source.externalId);
    const result = await service.reconcile({ inspected: true, source, taskId: "task-inspected" });
    expect(result.existing).toBe(true); expect(result.snapshot?.externalLinks[0].taskId).toBe("task-inspected");
    expect(adapter.getTask).toHaveBeenCalledWith("task-inspected"); expect(adapter.createTask).not.toHaveBeenCalled(); expect(adapter.updateTask).not.toHaveBeenCalled();
    expect((await service.create({ task: core, source })).task.id).toBe("task-inspected"); expect(adapter.createTask).not.toHaveBeenCalled();
    await expect(service.reconcile({ inspected: true, source, taskId: "different" })).rejects.toMatchObject({ code: "CONVERSION_CONFLICT" });
  });
  it("rejects active create reconciliation and direct link mutation without overwriting claims", async () => {
    const { repo, service } = setup(); repo.claimExternalConversion(source.source, source.externalId);
    await expect(service.reconcile({ inspected: true, source, taskId: "task-existing" })).rejects.toMatchObject({ code: "CONVERSION_ACTIVE" });
    await expect(repo.mutate({ action: "linkExternal", ...source, taskId: "task-existing" })).rejects.toMatchObject({ code: "CONVERSION_CONFLICT" });
    expect(repo.getExternalConversion(source.source, source.externalId)).toMatchObject({ state: "creating", taskId: null });
  });
  it("rechecks active claims after asynchronous task inspection", async () => {
    const { repo, service, adapter } = setup(); let release!: (value: Task) => void;
    adapter.getTask.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const linking = service.reconcile({ inspected: true, source, taskId: "task-existing" });
    repo.claimExternalConversion(source.source, source.externalId); release({ ...task, id: "task-existing" });
    await expect(linking).rejects.toMatchObject({ code: "CONVERSION_ACTIVE" }); expect((await repo.snapshot()).externalLinks).toEqual([]);
  });
  it("requires matching verified task identity and explicit inspection", async () => {
    const { service, adapter, repo } = setup(); adapter.getTask.mockResolvedValueOnce({ ...task, id: "other" });
    await expect(service.reconcile({ inspected: true, source, taskId: "requested" })).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });
    expect((await repo.snapshot()).externalLinks).toEqual([]);
    await expect(service.reconcile({ inspected: false, source, taskId: "task-1" } as never)).rejects.toThrow();
  });
  it("atomically restores combined draft/source ledgers while keeping the original source immutable", async () => {
    const { repo, service } = setup();
    await repo.mutate({ action: "saveDraft", draft: { id: "draft-inspected", input: "source input", title: "source title", dates: core.dates, areaId: core.areaId, projectId: core.projectId, tags: [], priority: "none", recurrenceRule: null, source: source.source, externalId: source.externalId, externalUrl: source.url } });
    repo.claimExternalConversion("draft", "draft-inspected"); repo.failExternalConversion("draft", "draft-inspected");
    await expect(service.reconcile({ inspected: true, draftId: "draft-inspected", taskId: "task-existing" })).rejects.toMatchObject({ code: "DRAFT_SOURCE" });
    const result = await service.reconcile({ inspected: true, source, draftId: "draft-inspected", taskId: "task-existing" });
    expect(result.snapshot?.externalLinks[0].taskId).toBe("task-existing"); expect(repo.getExternalConversion("draft", "draft-inspected")?.taskId).toBe("task-existing");
    const { createdAt: _created, updatedAt: _updated, ...draft } = result.snapshot!.drafts[0];
    await expect(repo.mutate({ action: "saveDraft", draft: { ...draft, source: "quick-add", externalId: null, externalUrl: null } })).rejects.toMatchObject({ code: "DRAFT_SOURCE" });
  });
  it("marks only interrupted startup conversions uncertain while preserving confirmed IDs", async () => {
    const { db, repo, service, adapter } = setup();
    repo.claimExternalConversion(source.source, source.externalId); repo.claimExternalConversion("draft", "finished"); repo.finishExternalConversion("draft", "finished", "confirmed-task");
    recoverInterruptedConversions(db);
    expect(repo.getExternalConversion("draft", "finished")).toMatchObject({ state: "complete", taskId: "confirmed-task" });
    expect(repo.getExternalConversion(source.source, source.externalId)?.state).toBe("uncertain");
    await service.reconcile({ inspected: true, source, taskId: "task-inspected" }); expect(adapter.createTask).not.toHaveBeenCalled();
  });
  it("saves optional metadata/tags and returns the canonical snapshot", async () => {
    const { service } = setup();
    const result = await service.create({ task: core, metadata: { priority: "high", recurrenceRule: { frequency: "week", interval: 2 } }, tags: ["school"] });
    expect(result.snapshot?.metadata[0]).toMatchObject({ taskId: result.task.id, priority: "high" });
    expect(result.snapshot?.tags[0].name).toBe("school"); expect(result.warnings).toEqual([]);
  });
  it("returns confirmed task ID and a warning when local extensions fail after creation", async () => {
    const { service, repo, adapter } = setup(); vi.spyOn(repo, "mutate").mockRejectedValue(new Error("local failure"));
    const result = await service.create({ task: core, metadata: { priority: "high" } });
    expect(result.task.id).toBe("task-2"); expect(result.warnings[0]).toContain("do not create it again"); expect(adapter.createTask).toHaveBeenCalledOnce();
  });
  it("prevents concurrent conversions of one external item", async () => {
    const { service, adapter, repo } = setup();
    let release!: (task: Task) => void;
    adapter.createTask.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = service.create({ task: core, source });
    // Both calls run before the remote first create returns. The atomic claim
    // prevents a second create across requests rather than checking only links.
    const second = service.create({ task: core, source });
    await expect(second).rejects.toMatchObject({ code: "CONVERSION_UNCERTAIN" });
    release({ ...task, id: "task-2" });
    await first;
    expect(adapter.createTask).toHaveBeenCalledOnce();
    expect(repo.getExternalConversion(source.source, source.externalId)?.state).toBe("complete");
    expect((await service.create({ task: core, source })).existing).toBe(true);
    expect(adapter.createTask).toHaveBeenCalledOnce();
  });
  it("recovers an existing confirmed conversion from its ledger if linking failed", async () => {
    const { service, repo, adapter } = setup(); vi.spyOn(repo, "mutate").mockRejectedValueOnce(new Error("link failed"));
    const first = await service.create({ task: core, source }); expect(first.warnings).toHaveLength(1);
    const second = await service.create({ task: core, source }); expect(second.task.id).toBe(first.task.id); expect(second.existing).toBe(true);
    expect(adapter.createTask).toHaveBeenCalledOnce();
  });
  it.each([
    new AppError("RELATION_CONFLICT", "Correct relation", 422),
    new AppError("NOTION_DISABLED", "Configure Notion", 503),
    new AppError("NOTION_UNAVAILABLE", "Read unavailable", 502, { operation: "graph.paginate", upstreamStatus: 503 }),
    new AppError("NOTION_UNAVAILABLE", "Rejected create", 502, { operation: "task.create", upstreamStatus: 400 }),
  ])("releases external claim after definite preflight/read/rejected-write failure %#", async error => {
    const { service, adapter, repo } = setup(); adapter.createTask.mockRejectedValueOnce(error);
    await expect(service.create({ task: core, source })).rejects.toThrow();
    expect(repo.getExternalConversion(source.source, source.externalId)).toBeNull();
    const corrected = await service.create({ task: core, source }); expect(corrected.task.id).toBe("task-2");
  });
  it("never retries an uncertain remote create for external conversions", async () => {
    const { service, adapter, repo } = setup(); adapter.createTask.mockRejectedValueOnce(new AppError("NOTION_UNAVAILABLE", "Timeout", 502, { operation: "task.create", upstreamStatus: null }));
    await expect(service.create({ task: core, source })).rejects.toThrow();
    expect(repo.getExternalConversion(source.source, source.externalId)?.state).toBe("uncertain");
    await expect(service.create({ task: core, source })).rejects.toMatchObject({ code: "CONVERSION_UNCERTAIN" });
    expect(adapter.createTask).toHaveBeenCalledOnce();
  });
  it("records a known remote task ID even if its create response could not be decoded", async () => {
    const { service, adapter, repo } = setup(); adapter.createTask.mockRejectedValueOnce(new AppError("NOTION_WRITE_OUTCOME", "Created but unreadable", 502, { operation: "task.create", taskId: "task-9" }));
    await expect(service.create({ task: core, source })).rejects.toThrow();
    expect(repo.getExternalConversion(source.source, source.externalId)?.taskId).toBe("task-9");
    expect((await service.create({ task: core, source })).task.id).toBe("task-9"); expect(adapter.createTask).toHaveBeenCalledOnce();
  });
  it("completes once and creates only one shifted recurrence, preserving local priority/tags and relations", async () => {
    const { service, repo, adapter } = setup();
    await repo.mutate({ action: "setTaskMetadata", taskId: task.id, patch: { priority: "high", recurrenceRule: { frequency: "week", interval: 2 } } });
    await repo.mutate({ action: "setTaskTags", taskId: task.id, tags: ["school"] });
    const result = await service.update(task.id, { completed: true });
    expect(result.task.completed).toBe(true); expect(result.nextTask?.dates).toEqual({ start: "2026-10-17", end: "2026-11-01" });
    expect(result.nextTask).toMatchObject({ areaId: core.areaId, projectId: core.projectId, highlight: true });
    expect(result.snapshot?.metadata.find(value => value.taskId === result.nextTask!.id)?.priority).toBe("high");
    expect(result.snapshot?.taskTags.some(value => value.taskId === result.nextTask!.id)).toBe(true);
    await service.update(task.id, { completed: false }); await service.update(task.id, { completed: true });
    expect(adapter.createTask).toHaveBeenCalledOnce();
  });
  it("reports successful completion plus an uncertain recurrence warning and blocks duplicate creation", async () => {
    const { service, repo, adapter } = setup();
    await repo.mutate({ action: "setTaskMetadata", taskId: task.id, patch: { recurrenceRule: { frequency: "month", interval: 1 } } });
    adapter.createTask.mockRejectedValueOnce(new Error("unknown remote timeout"));
    const result = await service.update(task.id, { completed: true }); expect(result.task.completed).toBe(true); expect(result.warnings[0]).toContain("not confirmed");
    await service.update(task.id, { completed: true }); expect(adapter.createTask).toHaveBeenCalledOnce(); expect(repo.getRecurrence(task.id)?.state).toBe("failed");
  });
  it("clamps month/year shifts and preserves null dates", () => {
    expect(shiftRecurringDates({ start: "2026-01-31", end: null }, { frequency: "month", interval: 1 })).toEqual({ start: "2026-02-28", end: null });
    expect(shiftRecurringDates({ start: "2024-02-29", end: "2024-03-01" }, { frequency: "year", interval: 1 })).toEqual({ start: "2025-02-28", end: "2025-03-01" });
  });
});

describe("Inbox draft conversion ledger", () => {
  async function saveDraft(repo: ReturnType<typeof createRepository>, sourceItem?: typeof source) {
    await repo.mutate({ action: "saveDraft", draft: { id: "draft-1", input: "Presentation #English tomorrow [school]", title: core.title, areaId: core.areaId, projectId: core.projectId, dates: core.dates, tags: ["school"], priority: "high", recurrenceRule: null, source: sourceItem?.source ?? "quick-add", externalId: sourceItem?.externalId ?? null, externalUrl: sourceItem?.url ?? null } });
  }
  it("rejects missing drafts before claiming or creating", async () => {
    const { service, adapter, repo } = setup();
    await expect(service.create({ task: core, draftId: "missing" })).rejects.toMatchObject({ code: "DRAFT_UNAVAILABLE" });
    expect(adapter.createTask).not.toHaveBeenCalled(); expect(repo.getExternalConversion("draft", "missing")).toBeNull();
  });
  it("atomically blocks concurrent conversions and returns the confirmed ID after cleanup failure", async () => {
    const { service, adapter, repo } = setup(); await saveDraft(repo);
    let release!: (task: Task) => void;
    adapter.createTask.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = service.create({ task: core, draftId: "draft-1" });
    await expect(service.create({ task: core, draftId: "draft-1" })).rejects.toMatchObject({ code: "CONVERSION_UNCERTAIN" });
    release({ ...task, id: "task-confirmed" });
    await first;
    vi.spyOn(repo, "mutate").mockRejectedValueOnce(new Error("cleanup failed"));
    await expect(repo.mutate({ action: "deleteDraft", id: "draft-1" })).rejects.toThrow("cleanup failed");
    const reopened = await service.create({ task: { ...core, title: "different title" }, draftId: "draft-1" });
    expect(reopened.existing).toBe(true); expect(reopened.task.id).toBe("task-confirmed");
    expect(adapter.createTask).toHaveBeenCalledOnce();
    await repo.mutate({ action: "deleteDraft", id: "draft-1" });
    expect((await service.create({ task: core, draftId: "draft-1" })).existing).toBe(true);
  });
  it.each([
    new AppError("RELATION_CONFLICT", "Correct relation", 422),
    new AppError("NOTION_UNAVAILABLE", "Read failed", 502, { operation: "graph.paginate", upstreamStatus: 503 }),
    new AppError("NOTION_UNAVAILABLE", "Rejected", 502, { operation: "task.create", upstreamStatus: 400 }),
  ])("releases both draft and source claims after definite failure %#", async error => {
    const { service, adapter, repo } = setup(); await saveDraft(repo, source); adapter.createTask.mockRejectedValueOnce(error);
    await expect(service.create({ task: core, draftId: "draft-1", source })).rejects.toThrow();
    expect(repo.getExternalConversion("draft", "draft-1")).toBeNull(); expect(repo.getExternalConversion(source.source, source.externalId)).toBeNull();
    expect((await service.create({ task: core, draftId: "draft-1", source })).task.id).toBe("task-2");
  });
  it("retains both uncertain claims and never replays the remote create", async () => {
    const { service, adapter, repo } = setup(); await saveDraft(repo, source);
    adapter.createTask.mockRejectedValueOnce(new AppError("NOTION_UNAVAILABLE", "Timeout", 502, { operation: "task.create" }));
    await expect(service.create({ task: core, draftId: "draft-1", source })).rejects.toThrow();
    expect(repo.getExternalConversion("draft", "draft-1")?.state).toBe("uncertain");
    await expect(service.create({ task: core, draftId: "draft-1", source })).rejects.toMatchObject({ code: "CONVERSION_UNCERTAIN" });
    expect(adapter.createTask).toHaveBeenCalledOnce();
  });
  it("does not leave a draft claim when the external source is already pending", async () => {
    const { service, adapter, repo } = setup(); await saveDraft(repo, source); repo.claimExternalConversion(source.source, source.externalId);
    await expect(service.create({ task: core, draftId: "draft-1", source })).rejects.toMatchObject({ code: "CONVERSION_UNCERTAIN" });
    expect(repo.getExternalConversion("draft", "draft-1")).toBeNull(); expect(adapter.createTask).not.toHaveBeenCalled();
  });
  it("records a known ID even if remote response decoding fails", async () => {
    const { service, adapter, repo } = setup(); await saveDraft(repo);
    adapter.createTask.mockRejectedValueOnce(new AppError("NOTION_WRITE_OUTCOME", "Created", 502, { operation: "task.create", taskId: "confirmed-9" }));
    await expect(service.create({ task: core, draftId: "draft-1" })).rejects.toThrow();
    expect(repo.getExternalConversion("draft", "draft-1")?.taskId).toBe("confirmed-9");
    expect((await service.create({ task: core, draftId: "draft-1" })).task.id).toBe("confirmed-9"); expect(adapter.createTask).toHaveBeenCalledOnce();
  });
  it("reuses an existing source and recovers its missing link without overwriting metadata", async () => {
    const { service, adapter, repo } = setup(); await saveDraft(repo, source);
    repo.claimExternalConversion(source.source, source.externalId); repo.finishExternalConversion(source.source, source.externalId, "existing-task");
    await repo.mutate({ action: "setTaskMetadata", taskId: "existing-task", patch: { priority: "urgent" } });
    const result = await service.create({ task: core, draftId: "draft-1", source, metadata: { priority: "low" }, tags: ["overwrite"] });
    expect(result.existing).toBe(true); expect(adapter.createTask).not.toHaveBeenCalled();
    expect(result.snapshot?.externalLinks[0].taskId).toBe("existing-task"); expect(result.snapshot?.metadata[0].priority).toBe("urgent");
    expect(result.snapshot?.tags).toEqual([]); expect(repo.getExternalConversion("draft", "draft-1")?.taskId).toBe("existing-task");
  });
  it("returns existing task plus a warning when local recovery fails after remote confirmation", async () => {
    const { service, adapter, repo } = setup(); await saveDraft(repo, source);
    repo.claimExternalConversion(source.source, source.externalId); repo.finishExternalConversion(source.source, source.externalId, "existing-task");
    vi.spyOn(repo, "mutate").mockRejectedValueOnce(new Error("local unavailable"));
    const result = await service.create({ task: core, draftId: "draft-1", source });
    expect(result.existing).toBe(true); expect(result.task.id).toBe("existing-task"); expect(result.warnings[0]).toContain("Do not create it again"); expect(adapter.createTask).not.toHaveBeenCalled();
  });
  it("rejects altered draft source before any remote create", async () => {
    const { service, adapter, repo } = setup(); await saveDraft(repo, source);
    await expect(service.create({ task: core, draftId: "draft-1", source: { ...source, externalId: "different" } })).rejects.toMatchObject({ code: "DRAFT_SOURCE" });
    expect(adapter.createTask).not.toHaveBeenCalled(); expect(repo.getExternalConversion("draft", "draft-1")).toBeNull();
  });
});
