import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { ApiClientError } from "../src/lib/api-client";
import { optimisticCache, mutationStatusKey, type Intent, type MutationStatus, type Operation } from "../src/lib/optimistic";
import { taskIntent } from "../src/lib/task-queries";
import { contactIntent } from "../src/lib/contact-queries";
import { applyLocal, prepareLocal, reconcileLocal } from "../src/lib/local-intents";
import type { LocalMutation } from "../src/lib/schemas";
import type { GraphResponse } from "../src/lib/queries";
import type { LocalSnapshot, Task } from "../src/lib/types";
import type { ContactOptions, ContactResponse } from "../src/lib/contact-contracts";
import { tasksForView, viewTaskCount } from "../src/lib/views";

const now = "2026-10-04T12:00:00Z";
const task = (id: string, title = id): Task => ({ id, title, areaId: "a", projectId: "p", dates: { start: "2026-10-04", end: "2026-10-04" }, highlight: false, completed: false, url: "https://notion.so/task", createdAt: now, updatedAt: now });
const local = (): LocalSnapshot => ({ metadata: [], notes: [], attachments: [], links: [], tags: [], taskTags: [], aliases: [], filters: [], integrations: [], externalLinks: [], drafts: [], preferences: { theme: "dark", sidebarCollapsed: false, lastView: "today", notificationPermissionAsked: false }, notionMapping: {} });
function fixture() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["graph"], { graph: { areas: [{ id: "a", name: "A", type: null, url: "", projectIds: ["p"] }, { id: "b", name: "B", type: null, url: "", projectIds: ["p"] }], projects: [{ id: "p", name: "P", areaIds: ["a", "b"], status: null, priority: null, dates: { start: null, end: null }, url: "" }], tasks: [task("first"), task("target", "A"), task("last")], syncedAt: now }, diagnostics: [], completionEnabled: true } satisfies GraphResponse);
  client.setQueryData(["local"], local());
  const cache = optimisticCache(client), tasks = () => client.getQueryData<GraphResponse>(["graph"])!.graph.tasks;
  return { client, cache, tasks };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function finish<T>(cache: ReturnType<typeof optimisticCache>, op: Operation<T>) { try { const value = await cache.request(op); cache.succeed(op, value); return value; } catch (error) { cache.fail(op, error); throw error; } finally { op.release(); } }
function localIntent(client: QueryClient, action: LocalMutation, request: () => Promise<{ snapshot: LocalSnapshot }>): Intent<{ snapshot: LocalSnapshot }> {
  const cache = optimisticCache(client); action = prepareLocal(action); const id = "temp:local";
  return { key: "local-test", targets: [["local"]], apply: data => applyLocal(data as LocalSnapshot, action, id, now), request, reconcile: (data, result) => reconcileLocal(data as LocalSnapshot, result.snapshot, action, id, cache), errorMessage: "Couldn't save changes.", keepOnError: action.action === "saveNote" };
}
describe("ordered optimistic task cache", () => {
  it("retains recent completion on acknowledgement even when an older server omits its timestamp", async () => {
    const { client, cache, tasks } = fixture();
    const op = cache.begin(taskIntent(client, { kind: "patch", id: "target", body: { completed: true } }, async () => ({ task: { ...task("target"), completed: true }, warnings: [] })));
    const optimisticDate = tasks()[1].completedAt!;
    expect(optimisticDate).toEqual(expect.any(String));
    expect(client.getQueryData<LocalSnapshot>(["local"])!.metadata[0].completedAt).toBe(optimisticDate);
    await finish(cache, op);
    expect(tasks()[1].completedAt).toBe(optimisticDate);
    const graph = client.getQueryData<GraphResponse>(["graph"])!.graph;
    expect(tasksForView("project:p", graph, client.getQueryData<LocalSnapshot>(["local"])!, optimisticDate.slice(0, 10)).map(task => task.id)).toContain("target");
  });
  it.each([401, 403, 404, 409, 429, 500, "timeout", "network"])("completes immediately and restores exact order on %s", async status => {
    const { client, cache, tasks } = fixture(); const failure = deferred<never>();
    const op = cache.begin(taskIntent(client, { kind: "patch", id: "target", body: { completed: true } }, () => failure.promise));
    expect(tasks().find(task => task.id === "target")!.completed).toBe(true);
    expect(tasks().filter(task => !task.completed)).toHaveLength(2);
    const done = finish(cache, op); failure.reject(typeof status === "number" ? new ApiClientError("raw upstream", status, "NOTION_ERROR") : new Error(status));
    await expect(done).rejects.toThrow();
    expect(tasks().map(task => task.id)).toEqual(["first", "target", "last"]); expect(tasks()[1].completed).toBe(false);
    expect(client.getQueryData<MutationStatus>(mutationStatusKey)!.errors[0].message).toBe("Couldn't complete task.");
  });
  it("does not roll back another task's successful write", async () => {
    const { client, cache, tasks } = fixture(); const fail = deferred<never>();
    const a = cache.begin(taskIntent(client, { kind: "patch", id: "target", body: { completed: true } }, () => fail.promise)); const first = finish(cache, a);
    const b = cache.begin(taskIntent(client, { kind: "patch", id: "last", body: { task: { title: "Independent" } } }, async () => ({ task: task("last", "Independent"), warnings: [] })));
    await finish(cache, b); fail.reject(new Error("denied")); await expect(first).rejects.toThrow();
    expect(tasks()[2].title).toBe("Independent");
  });
  it("renders C while B is pending and serializes requests for the same entity", async () => {
    const { client, cache, tasks } = fixture(); const b = deferred<{ task: Task; warnings: string[] }>(), c = deferred<{ task: Task; warnings: string[] }>(); const sent: string[] = [];
    const one = cache.begin(taskIntent(client, { kind: "patch", id: "target", body: { task: { title: "B" } } }, () => { sent.push("B"); return b.promise; })); const first = finish(cache, one);
    const two = cache.begin(taskIntent(client, { kind: "patch", id: "target", body: { task: { title: "C" } } }, () => { sent.push("C"); return c.promise; })); const second = finish(cache, two);
    await Promise.resolve(); expect(sent).toEqual(["B"]); expect(tasks()[1].title).toBe("C");
    c.resolve({ task: task("target", "C"), warnings: [] }); // Even if the later response is ready first, it cannot commit ahead of B.
    b.resolve({ task: task("target", "B"), warnings: [] }); await first; expect(tasks()[1].title).toBe("C"); await second; expect(tasks()[1].title).toBe("C");
  });
  it("removes only a failed earlier intent while retaining the newer title", async () => {
    const { client, cache, tasks } = fixture(); const a = deferred<never>();
    const one = cache.begin(taskIntent(client, { kind: "patch", id: "target", body: { task: { title: "B" } } }, () => a.promise)); const first = finish(cache, one);
    const two = cache.begin(taskIntent(client, { kind: "patch", id: "target", body: { task: { title: "C" } } }, async () => ({ task: task("target", "C"), warnings: [] }))); const second = finish(cache, two);
    a.reject(new Error("no")); await expect(first).rejects.toThrow(); expect(tasks()[1].title).toBe("C"); await second; expect(tasks()[1].title).toBe("C");
  });
  it("rejects invalid relations before optimism", () => { const { client, tasks } = fixture(); expect(() => taskIntent(client, { kind: "patch", id: "target", body: { task: { areaId: "missing" } } })).toThrow(); expect(tasks()[1].areaId).toBe("a"); });
  it("rolls back a move and a confirmed deletion immediately", async () => {
    const { client, cache, tasks } = fixture(); const move = cache.begin(taskIntent(client, { kind: "patch", id: "target", body: { task: { areaId: "b" } } }, async () => { throw new Error("no"); })); expect(tasks()[1].areaId).toBe("b"); await expect(finish(cache, move)).rejects.toThrow(); expect(tasks()[1].areaId).toBe("a");
    const del = cache.begin(taskIntent(client, { kind: "delete", id: "target" }, async () => { throw new Error("no"); })); expect(tasks()).toHaveLength(2); await expect(finish(cache, del)).rejects.toThrow(); expect(tasks().map(task => task.id)).toEqual(["first", "target", "last"]);
  });
  it("ignores a read that started before a mutation, including after success", async () => {
    const { client, cache, tasks } = fixture(); const revision = cache.readRevision(["graph"]), stale = structuredClone(client.getQueryData<GraphResponse>(["graph"])!);
    const op = cache.begin(taskIntent(client, { kind: "patch", id: "target", body: { task: { title: "B" } } }, async () => ({ task: task("target", "B"), warnings: [] })));
    client.setQueryData(["graph"], cache.acceptRead(["graph"], stale, revision)); expect(tasks()[1].title).toBe("B"); await finish(cache, op);
    client.setQueryData(["graph"], cache.acceptRead(["graph"], stale, revision)); expect(tasks()[1].title).toBe("B");
  });
  it("ignores older confirmed task versions and retained error/offline snapshots after success", async () => {
    const { client, cache, tasks } = fixture(); const stale = structuredClone(client.getQueryData<GraphResponse>(["graph"])!);
    const op = cache.begin(taskIntent(client, { kind: "patch", id: "target", body: { task: { title: "B" } } }, async () => ({ task: { ...task("target", "B"), updatedAt: "2026-10-04T12:01:00Z" }, warnings: [] }))); await finish(cache, op);
    client.setQueryData(["graph"], cache.acceptRead(["graph"], stale, cache.readRevision(["graph"]))); expect(tasks()[1].title).toBe("B");
    const error = { ...stale, diagnostics: [{ source: "notion" as const, status: "error" as const, message: "Retained data" }] };
    client.setQueryData(["graph"], cache.acceptRead(["graph"], error, cache.readRevision(["graph"]))); expect(tasks()[1].title).toBe("B");
    client.setQueryData(["graph"], cache.acceptRead(["graph"], stale, cache.readRevision(["graph"]), true)); expect(tasks()[1].title).toBe("B");
    const fresh = structuredClone(stale); fresh.graph.tasks[1] = { ...task("target", "Server conflict"), updatedAt: "2026-10-04T12:02:00Z" };
    client.setQueryData(["graph"], cache.acceptRead(["graph"], fresh, cache.readRevision(["graph"]))); expect(tasks()[1].title).toBe("Server conflict");
  });
  it("reconciles a temporary task and queued edit without duplication or key changes", async () => {
    const { client, cache, tasks } = fixture(); const remote = deferred<{ task: Task; warnings: string[]; snapshot: LocalSnapshot }>(); const ids: string[] = [];
    const create = cache.begin(taskIntent(client, { kind: "create", tempId: "temp:new", body: { task: { title: "New", areaId: "a", projectId: "p", dates: { start: "2026-10-04", end: null } }, tags: ["new"], metadata: { priority: "high" } } }, () => remote.promise)); const first = finish(cache, create);
    expect(tasks().at(-1)!.id).toBe("temp:new");
    const edit = cache.begin(taskIntent(client, { kind: "patch", id: "temp:new", body: { task: { title: "Edited" } } }, async () => { ids.push(cache.resolveId("temp:new")); return { task: task("real-new", "Edited"), warnings: [] }; })); const second = finish(cache, edit);
    expect(tasks().at(-1)!.title).toBe("Edited"); remote.resolve({ task: task("real-new", "New"), warnings: [], snapshot: local() }); await first; expect(tasks().at(-1)!.title).toBe("Edited"); await second;
    expect(ids).toEqual(["real-new"]); expect(tasks()).toHaveLength(4); expect(tasks().at(-1)!.clientKey).toBe("temp:new");
  });
  it("queues deletion behind create and never restores a ghost temporary row", async () => {
    const { client, cache, tasks } = fixture(); const remote = deferred<{ task: Task; warnings: string[] }>(); let deleted = "";
    const create = cache.begin(taskIntent(client, { kind: "create", tempId: "temp:new", body: { task: { title: "New", areaId: "a", projectId: "p", dates: { start: null, end: null } } } }, () => remote.promise)); const first = finish(cache, create);
    const del = cache.begin(taskIntent(client, { kind: "delete", id: "temp:new" }, async () => { deleted = cache.resolveId("temp:new"); return null; })); const second = finish(cache, del); expect(tasks()).toHaveLength(3);
    remote.resolve({ task: task("real-new"), warnings: [] }); await first; expect(tasks()).toHaveLength(3); await second; expect(deleted).toBe("real-new"); expect(tasks()).toHaveLength(3);
  });
  it("failed create removes its temporary task and source link, with no unsafe Retry", async () => {
    const { client, cache, tasks } = fixture(); const op = cache.begin(taskIntent(client, { kind: "create", body: { task: { title: "New", areaId: "a", projectId: "p", dates: { start: null, end: null } }, source: { source: "github", externalId: "issue", url: null } } }, async () => { throw new Error("network"); }));
    expect(tasks()).toHaveLength(4); expect(client.getQueryData<LocalSnapshot>(["local"])!.externalLinks).toHaveLength(1); await expect(finish(cache, op)).rejects.toThrow(); expect(tasks()).toHaveLength(3); expect(client.getQueryData<LocalSnapshot>(["local"])!.externalLinks).toHaveLength(0); expect(client.getQueryData<MutationStatus>(mutationStatusKey)!.errors[0].retryable).toBe(false);
  });
});

describe("local and Contact intents", () => {
  it("all derived task counts change together and return together on rollback", async () => {
    const { client, cache } = fixture(); const snapshot = local(); snapshot.tags = [{ id: "tag", name: "school", color: null }]; snapshot.taskTags = [{ taskId: "target", tagId: "tag" }]; snapshot.filters = [{ id: "f", name: "Active", criteria: { completed: false }, createdAt: now, updatedAt: now }]; client.setQueryData(["local"], snapshot);
    const counts = () => ["today", "next", "project:p", "area:a", "tag:tag", "filter:f"].map(view => viewTaskCount(view, client.getQueryData<GraphResponse>(["graph"])!.graph, client.getQueryData<LocalSnapshot>(["local"])!, "2026-10-04"));
    expect(counts()).toEqual([3, 3, 3, 3, 1, 3]);
    const op = cache.begin(taskIntent(client, { kind: "patch", id: "target", body: { completed: true } }, async () => { throw new Error("no"); })); expect(counts()).toEqual([2, 2, 2, 2, 0, 2]); await expect(finish(cache, op)).rejects.toThrow(); expect(counts()).toEqual([3, 3, 3, 3, 1, 3]);
  });
  it("theme persistence failure retains the session choice until retry succeeds", async () => {
    const { client, cache } = fixture(); let failing = true; const saved = local(); saved.preferences.theme = "light";
    const op = cache.begin({ ...localIntent(client, { action: "setPreferences", patch: { theme: "light" } }, async () => { if (failing) throw new Error("SQLite"); return { snapshot: saved }; }), keepOnError: true }); await expect(finish(cache, op)).rejects.toThrow(); expect(client.getQueryData<LocalSnapshot>(["local"])!.preferences.theme).toBe("light"); failing = false; await cache.retry(op.id); expect(client.getQueryData<MutationStatus>(mutationStatusKey)!.operations).toHaveLength(0);
  });
  it.each(["setTaskMetadata", "setTaskTags", "saveFilter", "saveIntegration", "addLink"] as const)("%s changes cache before persistence and rolls back only its scope", async kind => {
    const { client, cache } = fixture(); const actions: Record<typeof kind, LocalMutation> = { setTaskMetadata: { action: "setTaskMetadata", taskId: "target", patch: { priority: "urgent", someday: true, reminderAt: now } }, setTaskTags: { action: "setTaskTags", taskId: "target", tags: ["test"] }, saveFilter: { action: "saveFilter", name: "Now", criteria: { priority: "urgent" } }, saveIntegration: { action: "saveIntegration", projectId: "p", repository: "owner/repo" }, addLink: { action: "addLink", entityType: "task", entityId: "target", url: "https://example.com", label: "Test" } };
    const before = structuredClone(client.getQueryData(["local"])); const op = cache.begin(localIntent(client, actions[kind], async () => { throw new Error("SQLite"); })); expect(client.getQueryData(["local"])).not.toEqual(before); await expect(finish(cache, op)).rejects.toThrow(); expect(client.getQueryData(["local"])).toEqual(before);
  });
  it("retains failed note content and retries without a stale read erasing it", async () => {
    const { client, cache } = fixture(); let failing = true; const saved = local(); saved.notes = [{ id: "note", entityType: "task", entityId: "target", content: "Important new content", createdAt: now, updatedAt: now }];
    const op = cache.begin(localIntent(client, { action: "saveNote", entityType: "task", entityId: "target", content: "Important new content" }, async () => { if (failing) throw new Error("SQLite"); return { snapshot: saved }; })); await expect(finish(cache, op)).rejects.toThrow();
    client.setQueryData(["local"], cache.acceptRead(["local"], local(), cache.readRevision(["local"]))); expect(client.getQueryData<LocalSnapshot>(["local"])!.notes[0]).toMatchObject({ content: "Important new content", unsaved: true }); failing = false; await cache.retry(op.id); expect(client.getQueryData<LocalSnapshot>(["local"])!.notes[0].unsaved).toBeUndefined();
  });
  it("keeps offline intents unsynced and retries in their original order", async () => {
    const { client, cache, tasks } = fixture(); let offline = true; const sent: string[] = [];
    const write = (title: string) => async () => { if (offline) throw new ApiClientError("Offline", 0, "OFFLINE"); sent.push(title); return { task: task("target", title), warnings: [] }; };
    const one = cache.begin(taskIntent(client, { kind: "patch", id: "target", body: { task: { title: "B" } } }, write("B"))); await expect(finish(cache, one)).rejects.toThrow();
    const two = cache.begin(taskIntent(client, { kind: "patch", id: "target", body: { task: { title: "C" } } }, write("C"))); await expect(finish(cache, two)).rejects.toThrow(); expect(tasks()[1].title).toBe("C"); expect(client.getQueryData<MutationStatus>(mutationStatusKey)!.operations).toHaveLength(2);
    offline = false; await cache.retry(two.id); expect(sent).toEqual(["B", "C"]); expect(tasks()[1].title).toBe("C"); expect(client.getQueryData<MutationStatus>(mutationStatusKey)!.operations).toHaveLength(0);
  });
  it.each([false, true])("Contact %s read state updates all counts, filters and detail before response", async deleting => {
    const { client, cache } = fixture(); const item = { id: 7, name: "Visitor", email: "a@example.com", message: "test", site_origin: "https://example.com", created_at: now, is_read: false };
    const keys = (["all", "read", "unread"] as const).map(filter => ["contact", { filter, sort: "newest", page: 1, site: "", search: "" } satisfies ContactOptions] as const);
    for (const key of keys) client.setQueryData(key, { items: key[1].filter === "read" ? [] : [item], total: key[1].filter === "read" ? 0 : 1, unreadTotal: 3, page: 1, hasMore: false, status: "ok", message: "", syncedAt: now, diagnostics: [] } satisfies ContactResponse);
    const op = cache.begin(contactIntent(client, deleting ? { id: 7 } : { id: 7, read: true }, async () => { throw new Error("PostgREST"); }));
    expect(client.getQueryData<ContactResponse>(keys[2])!.items).toHaveLength(0); for (const key of keys) expect(client.getQueryData<ContactResponse>(key)!.unreadTotal).toBe(2);
    if (!deleting) expect(client.getQueryData<ContactResponse>(keys[1])!.items[0].is_read).toBe(true);
    await expect(finish(cache, op)).rejects.toThrow(); expect(client.getQueryData<ContactResponse>(keys[2])!.items).toEqual([item]); for (const key of keys) expect(client.getQueryData<ContactResponse>(key)!.unreadTotal).toBe(3);
  });
  it("a Contact page opened mid-write does not subtract an already applied server count twice", async () => {
    const { client, cache } = fixture(); const item = { id: 7, name: "Visitor", email: "a@example.com", message: "test", site_origin: "https://example.com", created_at: now, is_read: false };
    const options: ContactOptions = { filter: "all", sort: "newest", page: 1, site: "", search: "" }, oldKey = ["contact", options];
    client.setQueryData(oldKey, { items: [item], total: 3, unreadTotal: 3, page: 1, hasMore: false, status: "ok", message: "", syncedAt: now, diagnostics: [] } satisfies ContactResponse);
    const response = deferred<{ item: typeof item }>(); const op = cache.begin(contactIntent(client, { id: 7, read: true }, () => response.promise)); const done = finish(cache, op);
    const newKey = ["contact", { ...options, filter: "unread", site: "https://example.com" }];
    const server = { items: [], total: 2, unreadTotal: 2, page: 1, hasMore: false, status: "ok" as const, message: "", syncedAt: now, diagnostics: [] };
    client.setQueryData(newKey, cache.acceptRead(newKey, server, cache.readRevision(newKey))); expect(client.getQueryData<ContactResponse>(newKey)!.unreadTotal).toBeNull();
    response.resolve({ item: { ...item, is_read: true } }); await done;
    client.setQueryData(newKey, cache.acceptRead(newKey, server, cache.readRevision(newKey))); expect(client.getQueryData<ContactResponse>(newKey)!.unreadTotal).toBe(2);
  });
});

