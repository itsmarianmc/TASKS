import { describe, expect, it, vi, afterEach } from "vitest";
import { acknowledgeDeviceDraft, flushDeviceDrafts, mergeDeviceDrafts, putDeviceDraft, readDeviceDrafts } from "../src/lib/device-drafts";
import { dueReminders, parseDeviceReminder, reminderSchedulingPatch, snoozeReminder, toDeviceDateTime } from "../src/lib/reminders";
import { deliverReminderOnce } from "../src/lib/reminder-delivery";
import type { Graph, InboxDraft, LocalSnapshot, TaskMetadata } from "../src/lib/types";

function storage(): Storage { const values = new Map<string, string>(); return { get length() { return values.size; }, clear: () => values.clear(), key: index => [...values.keys()][index] ?? null, getItem: key => values.get(key) ?? null, removeItem: key => { values.delete(key); }, setItem: (key, value) => { values.set(key, value); } }; }
const instant = "2026-10-03T12:00:00Z";
const draft = (id = "stable-id"): InboxDraft => ({ id, title: "Tomorrow #7 external title", input: "Tomorrow #7 external title", areaId: null, projectId: null, dates: { start: null, end: null }, priority: "none", tags: ["work"], recurrenceRule: null, source: "contact", externalId: "7", externalUrl: null, createdAt: instant, updatedAt: instant });
const local: LocalSnapshot = { metadata: [], notes: [], attachments: [], links: [], tags: [], taskTags: [], aliases: [], filters: [], integrations: [], externalLinks: [], drafts: [], preferences: { theme: "system", lastView: "today", sidebarCollapsed: false, notificationPermissionAsked: false }, notionMapping: {} };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("durable device drafts", () => {
  it("lost acknowledgement retries the same UUID and only confirmed success removes the entry", async () => {
    const device = storage(); putDeviceDraft(draft(), "save", device);
    const rows = new Map<string, InboxDraft>(); const ids: string[] = []; let fail = true;
    const send = vi.fn(async (action: Parameters<typeof import("../src/lib/api-client").localMutation>[0]) => {
      if (action.action !== "saveDraft") throw new Error("Wrong operation"); ids.push(action.draft.id!); rows.set(action.draft.id!, { ...action.draft, id: action.draft.id!, createdAt: instant, updatedAt: instant });
      if (fail) { fail = false; throw new Error("Applied but ACK lost"); }
      return { result: rows.get(action.draft.id!), snapshot: { ...local, drafts: [...rows.values()] } };
    });
    await expect(flushDeviceDrafts(() => {}, send, device)).rejects.toThrow("ACK lost"); expect(readDeviceDrafts(device)).toHaveLength(1);
    await flushDeviceDrafts(() => {}, send, device); expect(ids).toEqual(["stable-id", "stable-id"]); expect(rows.size).toBe(1); expect(readDeviceDrafts(device)).toHaveLength(0);
  });
  it("an edit during an older save acknowledgement remains queued", async () => {
    const device = storage(); const before = putDeviceDraft(draft(), "save", device); putDeviceDraft({ ...draft(), title: "Edited in another tab" }, "save", device);
    acknowledgeDeviceDraft(before, device); expect(readDeviceDrafts(device)[0].draft.title).toBe("Edited in another tab");
  });
  it("delete tombstones survive failure and hide both cached and queued copies", async () => {
    const device = storage(); putDeviceDraft(draft(), "delete", device); const entries = readDeviceDrafts(device);
    expect(mergeDeviceDrafts({ ...local, drafts: [draft()] }, entries).drafts).toHaveLength(0);
    const send = vi.fn(async () => { throw new Error("Offline"); }); await expect(flushDeviceDrafts(() => {}, send, device)).rejects.toThrow(); expect(readDeviceDrafts(device)[0].operation).toBe("delete");
    const success = vi.fn(async () => ({ result: null, snapshot: local })); await flushDeviceDrafts(() => {}, success, device); expect(success).toHaveBeenCalledWith({ action: "deleteDraft", id: "stable-id" }); expect(readDeviceDrafts(device)).toHaveLength(0);
  });
  it("merges matching SQLite records once and preserves verbatim source context", () => {
    const device = storage(); putDeviceDraft(draft(), "save", device); const merged = mergeDeviceDrafts({ ...local, drafts: [draft()] }, readDeviceDrafts(device)); expect(merged.drafts).toHaveLength(1); expect(merged.drafts[0]).toMatchObject({ source: "contact", externalId: "7", title: "Tomorrow #7 external title" });
  });
  it("invalid device data is never sent and storage failures retain caller input", () => {
    const device = storage(); device.setItem("taesks.device-draft.bad", '{"operation":"create-notion"}'); expect(readDeviceDrafts(device)).toEqual([]);
    device.setItem = () => { throw new Error("Quota exceeded"); }; expect(() => putDeviceDraft(draft(), "save", device)).toThrow("Quota");
  });
  it("corrupt IDs, revisions and timestamps never block synchronization of valid entries", async () => {
    const device = storage(); const entry = putDeviceDraft(draft(), "save", device);
    const corrupt = [
      { ...entry, draft: { ...draft(""), createdAt: instant, updatedAt: instant } },
      { ...entry, draft: { ...draft("unsafe/id"), createdAt: instant, updatedAt: instant } },
      { ...entry, revision: "not-a-uuid" },
      { ...entry, draft: { ...draft(), updatedAt: "yesterday" } },
      { ...entry }, // Valid body under a mismatched key is also ignored.
    ];
    corrupt.forEach((value, index) => device.setItem(`taesks.device-draft.corrupt-${index}`, JSON.stringify(value)));
    expect(readDeviceDrafts(device)).toHaveLength(1);
    const send = vi.fn(async () => ({ result: draft(), snapshot: { ...local, drafts: [draft()] } }));
    await flushDeviceDrafts(() => {}, send, device); expect(send).toHaveBeenCalledOnce(); expect(readDeviceDrafts(device)).toHaveLength(0);
  });
});
describe("reminder scheduling and delivery", () => {
  const metadata = (taskId: string, patch: Partial<TaskMetadata> = {}): TaskMetadata => ({ taskId, priority: "none", recurrenceRule: null, someday: false, reminderAt: instant, reminderDismissedAt: null, createdAt: instant, updatedAt: instant, ...patch });
  it("due instant includes its boundary, excludes completed/dismissed/future/invalid reminders", () => {
    const graph: Graph = { tasks: [{ id: "done", title: "Completed", completed: true, areaId: null, projectId: null, dates: { start: null, end: null }, highlight: false, url: "https://notion.so/done", createdAt: instant, updatedAt: instant }], areas: [], projects: [], syncedAt: instant };
    expect(dueReminders(graph, { ...local, metadata: [metadata("due"), metadata("done"), metadata("dismissed", { reminderDismissedAt: instant }), metadata("future", { reminderAt: "2026-10-03T12:01:00Z" }), metadata("invalid", { reminderAt: "invalid" })] }, Date.parse(instant)).map(value => value.taskId)).toEqual(["due"]);
  });
  it("saving unrelated local fields preserves a dismissed reminder and original seconds", () => {
    const original = "2026-10-03T12:00:32Z"; expect(reminderSchedulingPatch(toDeviceDateTime(original), original)).toEqual({});
    expect(reminderSchedulingPatch("", original)).toEqual({ reminderAt: null, reminderDismissedAt: null });
  });
  it("round-trips device wall time and rejects invalid calendar dates", () => {
    const wall = "2026-10-03T14:30"; expect(toDeviceDateTime(parseDeviceReminder(wall))).toBe(wall); expect(() => parseDeviceReminder("2026-02-30T14:30")).toThrow(); expect(() => parseDeviceReminder("invalid")).toThrow();
  });
  it("rejects the Berlin spring gap and repeated autumn hour", () => {
    vi.stubEnv("TZ", "Europe/Berlin");
    expect(() => parseDeviceReminder("2026-03-29T02:30")).toThrow("does not exist");
    expect(() => parseDeviceReminder("2026-10-25T02:30")).toThrow("occurs twice");
    expect(toDeviceDateTime(parseDeviceReminder("2026-10-25T03:30"))).toBe("2026-10-25T03:30");
  });
  it("snooze moves an instant by ten minutes and clears dismissal", () => { expect(snoozeReminder(Date.parse(instant))).toEqual({ reminderAt: "2026-10-03T12:10:00.000Z", reminderDismissedAt: null }); });
  it("concurrent tabs and reloads notify once per task plus reminder instant", async () => {
    let tail = Promise.resolve(); vi.stubGlobal("navigator", { locks: { request: (_name: string, work: () => Promise<unknown>) => { const result = tail.then(work); tail = result.then(() => {}, () => {}); return result; } } });
    const device = storage(); const show = vi.fn(async () => {});
    await Promise.all([deliverReminderOnce("task:time", show, device), deliverReminderOnce("task:time", show, device)]); await deliverReminderOnce("task:time", show, device); expect(show).toHaveBeenCalledTimes(1);
    await deliverReminderOnce("task:new-time", show, device); expect(show).toHaveBeenCalledTimes(2);
  });
  it("a failed system notification is not acknowledged and can retry", async () => {
    vi.stubGlobal("navigator", { locks: { request: (_name: string, work: () => Promise<unknown>) => work() } }); const device = storage();
    await expect(deliverReminderOnce("task:time", async () => { throw new Error("OS denied"); }, device)).rejects.toThrow(); expect(device.length).toBe(0);
    const show = vi.fn(async () => {}); await deliverReminderOnce("task:time", show, device); expect(show).toHaveBeenCalledOnce();
  });
});
