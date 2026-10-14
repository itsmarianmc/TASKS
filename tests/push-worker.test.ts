import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

async function worker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const showNotification = vi.fn(async () => undefined);
  const focus = vi.fn(async () => undefined); const postMessage = vi.fn(); const openWindow = vi.fn(async () => undefined);
  let windows: object[] = [{ focus, postMessage }];
  vm.runInNewContext(await readFile("public/service-worker.js", "utf8"), {
    self: { location: { origin: "https://taesks.test" }, registration: { showNotification }, clients: { matchAll: async () => windows, openWindow }, addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener) }, URL,
  });
  const dispatch = async (name: string, event: object) => {
    let pending: Promise<unknown> | undefined;
    listeners.get(name)!({ ...event, waitUntil: (work: Promise<unknown>) => { pending = work; } }); await pending;
  };
  return { dispatch, showNotification, focus, postMessage, openWindow, closed: () => { windows = []; } };
}
const taskId = "00000000-0000-4000-8000-000000000001";
const payload = { type: "reminder", taskId, reminderAt: "2026-10-07T12:00:00Z", tag: `taesks-${"a".repeat(43)}`, title: "Must never display", notes: "Private" };
describe("actual worker push handlers", () => {
  it("advertises the active worker capability for upgrade-safe enrollment", async () => {
    const f = await worker(); const reply = vi.fn(); await f.dispatch("message", { data: { type: "push-capability" }, ports: [{ postMessage: reply }] }); expect(reply).toHaveBeenCalledWith({ pushVersion: 1 });
  });
  it("shows generic content with a stable replacement tag even with an open client", async () => {
    const f = await worker(); await f.dispatch("push", { data: { json: () => payload } }); await f.dispatch("push", { data: { json: () => payload } });
    expect(f.showNotification).toHaveBeenCalledTimes(2);
    expect(f.showNotification.mock.calls[0]).toEqual(["TÆSKS / reminder", { body: "A reminder is due. Open TÆSKS.", tag: payload.tag, renotify: false, icon: "/icons/icon-192.png", data: { taskId } }]);
    expect(JSON.stringify(f.showNotification.mock.calls)).not.toContain(payload.title); expect(JSON.stringify(f.showNotification.mock.calls)).not.toContain(payload.notes);
  });
  it("ignores malformed or unrecognized payloads", async () => {
    const f = await worker();
    for (const value of [null, {}, { ...payload, taskId: "https://evil.test" }, { ...payload, tag: "unbounded" }, { ...payload, reminderAt: "invalid" }]) await f.dispatch("push", { data: { json: () => value } });
    await f.dispatch("push", { data: { json: () => { throw new Error("invalid JSON"); } } }); expect(f.showNotification).not.toHaveBeenCalled();
  });
  it("focuses task context in an existing app or opens the task URL", async () => {
    const f = await worker(); const close = vi.fn(); await f.dispatch("notificationclick", { notification: { close, data: { taskId } } });
    expect(close).toHaveBeenCalled(); expect(f.focus).toHaveBeenCalled(); expect(f.postMessage).toHaveBeenCalledWith({ type: "open-reminder", taskId });
    f.closed(); await f.dispatch("notificationclick", { notification: { close, data: { taskId } } }); expect(f.openWindow).toHaveBeenCalledWith(`/?reminder=${taskId}`);
  });
});
