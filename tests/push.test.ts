import { afterEach, describe, expect, it, vi } from "vitest";
import { createECDH } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase, type LocalDatabase } from "@/lib/server/db";
import { createPushStore, PUSH_LEASE_MS } from "@/lib/server/push-store";
import { createPushDispatcher } from "@/lib/server/push-dispatcher";
import { pushConfig } from "@/lib/server/push-config";
import { pushMutationSchema, pushSubscriptionSchema, supportedPushEndpoint } from "@/lib/push-contracts";
import { POST, GET } from "@/app/api/push/route";

const token = "a".repeat(64);
const pair = createECDH("prime256v1"); pair.setPrivateKey(Buffer.alloc(32, 1));
const subscription = (suffix = "one") => ({ endpoint: `https://web.push.apple.com/${suffix}`, keys: { p256dh: pair.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url") } });
const env = { APP_ORIGIN: "https://taesks.test", VAPID_PUBLIC_KEY: pair.getPublicKey().toString("base64url"), VAPID_PRIVATE_KEY: pair.getPrivateKey().toString("base64url"), VAPID_SUBJECT: "mailto:owner@example.test" };
const instant = Date.parse("2026-10-07T12:00:00Z");
const taskId = "00000000-0000-4000-8000-000000000001";
const databases: LocalDatabase[] = []; const directories: string[] = [];
function setup(filename = ":memory:") {
  const db = openDatabase(filename); databases.push(db); const store = createPushStore(db);
  let time = instant;
  const sender = vi.fn(async () => undefined); const isTaskOpen = vi.fn(async (_id: string) => true);
  const configured = vi.fn(() => true);
  const dispatch = createPushDispatcher({ store, send: sender, isTaskOpen, configured, now: () => time });
  const reminder = (at: string | null = new Date(instant).toISOString(), dismissed: string | null = null) => {
    db.sqlite.prepare("INSERT INTO task_metadata(notion_task_id,reminder_at,reminder_dismissed_at,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(notion_task_id) DO UPDATE SET reminder_at=excluded.reminder_at,reminder_dismissed_at=excluded.reminder_dismissed_at").run(taskId, at, dismissed, "now", "now");
  };
  store.register(token, subscription()); reminder();
  return { db, store, sender, isTaskOpen, configured, dispatch, reminder, advance: (ms: number) => { time += ms; } };
}
afterEach(() => { vi.unstubAllEnvs(); databases.splice(0).forEach(db => { try { db.sqlite.close(); } catch { /* Already closed for reopen test. */ } }); directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })); });

describe("subscription validation and configuration", () => {
  it("accepts browser keys and rejects invalid, private and arbitrary destinations", () => {
    expect(pushSubscriptionSchema.safeParse(subscription()).success).toBe(true);
    for (const endpoint of ["http://web.push.apple.com/x", "https://127.0.0.1/x", "https://web.push.apple.com.attacker.test/x", "https://user:secret@web.push.apple.com/x", "https://web.push.apple.com:8443/x", "https://fcm.googleapis.com/x#fragment", "https://evil.test/x"]) expect(supportedPushEndpoint(endpoint)).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ ...subscription(), keys: { auth: "short", p256dh: "short" } }).success).toBe(false);
    expect(pushMutationSchema.safeParse({ action: "revoke", deviceToken: "guess" }).success).toBe(false);
    expect(pushMutationSchema.safeParse({ action: "register", deviceToken: token, subscription: { ...subscription(), surprise: true } }).success).toBe(false);
  });
  it("requires matching VAPID keys and explicit HTTPS origin without leaking secrets", () => {
    expect(pushConfig({}).public).toMatchObject({ available: false, publicKey: null });
    expect(pushConfig(env).public.available).toBe(true);
    for (const patch of [{ VAPID_PRIVATE_KEY: "invalid" }, { APP_ORIGIN: "http://taesks.test" }, { APP_ORIGIN: "" }, { VAPID_SUBJECT: "mailto:invalid" }]) expect(pushConfig({ ...env, ...patch }).public.available).toBe(false);
    expect(JSON.stringify(pushConfig(env).public)).not.toContain(env.VAPID_PRIVATE_KEY);
  });
  it("replaces only the owning installation and never lists subscriptions publicly", () => {
    const f = setup(); const id = f.store.subscriptions()[0].id;
    expect(() => f.store.register("b".repeat(64), subscription())).toThrow("another installation");
    f.store.register(token, subscription("replacement"));
    expect(f.store.subscriptions()).toHaveLength(1); expect(f.store.subscriptions()[0].id).toBe(id);
    expect(f.store.status(token, subscription().endpoint)).toBe(false);
    f.store.revoke("b".repeat(64)); expect(f.store.subscriptions()).toHaveLength(1);
    f.store.revoke(token); expect(f.store.subscriptions()).toEqual([]);
  });
  it("API rejects cross-origin calls and reports missing configuration", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const get = GET(); expect(await get.json()).toMatchObject({ available: false, publicKey: null }); expect(get.headers.get("cache-control")).toBe("no-store");
    const request = new Request("https://taesks.test/api/push", { method: "POST", headers: { origin: "https://evil.test", "content-type": "application/json" }, body: JSON.stringify({ action: "revoke", deviceToken: token }) });
    expect((await POST(request)).status).toBe(403);
    const invalid = new Request("https://taesks.test/api/push", { method: "POST", headers: { origin: "https://taesks.test", "content-type": "application/json" }, body: JSON.stringify({ action: "register", deviceToken: token, subscription: subscription("bad") }) });
    // Missing configuration must be checked before opening the default database.
    expect((await POST(invalid)).status).toBe(503);
  });
});

describe("fake-sender dispatcher", () => {
  it("sends generic context once to every installation and persists deduplication", async () => {
    const f = setup(); f.store.register("b".repeat(64), subscription("two"));
    expect(await f.dispatch()).toMatchObject({ sent: 2 }); await f.dispatch();
    expect(f.sender).toHaveBeenCalledTimes(2);
    const payload = (f.sender.mock.calls as unknown as [unknown, Record<string, unknown>][])[0][1];
    expect(Object.keys(payload).sort()).toEqual(["reminderAt", "tag", "taskId", "type"]);
    expect(payload.tag).toMatch(/^taesks-[\w-]{43}$/);
    const restart = createPushDispatcher({ store: createPushStore(f.db), configured: () => true, isTaskOpen: f.isTaskOpen, send: f.sender, now: () => instant });
    await restart(); expect(f.sender).toHaveBeenCalledTimes(2);
  });
  it("does not touch status or sender without configuration", async () => {
    const f = setup(); f.configured.mockReturnValue(false); await f.dispatch(); expect(f.sender).not.toHaveBeenCalled(); expect(f.isTaskOpen).not.toHaveBeenCalled();
  });
  it.each(["future", "dismissed", "removed", "old", "completed", "unknown"])("does not send %s reminders", async state => {
    const f = setup();
    if (state === "future") f.reminder(new Date(instant + 1).toISOString());
    if (state === "dismissed") f.reminder(new Date(instant).toISOString(), "dismissed");
    if (state === "removed") f.reminder(null);
    if (state === "old") f.reminder(new Date(instant - 86400_001).toISOString());
    if (state === "completed") f.isTaskOpen.mockResolvedValue(false);
    if (state === "unknown") f.isTaskOpen.mockRejectedValue(new Error("Notion unavailable"));
    await f.dispatch(); expect(f.sender).not.toHaveBeenCalled();
  });
  it.each(["snooze", "dismiss", "edit", "revoke"])("rechecks %s made while remote status is loading", async change => {
    const f = setup(); f.isTaskOpen.mockImplementation(async () => {
      if (change === "snooze" || change === "edit") f.reminder(new Date(instant + 600_000).toISOString());
      if (change === "dismiss") f.reminder(new Date(instant).toISOString(), "dismissed");
      if (change === "revoke") f.store.revoke(token);
      return true;
    });
    await f.dispatch(); expect(f.sender).not.toHaveBeenCalled();
  });
  it("uses a new delivery key after snooze and normalizes equivalent instants", async () => {
    const f = setup(); await f.dispatch(); f.reminder("2026-10-07T14:00:00+02:00"); await f.dispatch(); expect(f.sender).toHaveBeenCalledTimes(1);
    f.reminder(new Date(instant + 600_000).toISOString()); await f.dispatch(); f.advance(600_000); await f.dispatch(); expect(f.sender).toHaveBeenCalledTimes(2);
  });
  it.each([404, 410])("removes expired endpoint on %s", async statusCode => {
    const f = setup(); f.sender.mockRejectedValue({ statusCode }); await f.dispatch(); expect(f.store.subscriptions()).toEqual([]); expect(f.db.sqlite.prepare("SELECT * FROM push_deliveries").all()).toEqual([]);
  });
  it("retries transient failures with backoff, rechecks completion and bounds attempts", async () => {
    const f = setup(); f.sender.mockRejectedValue({ statusCode: 503 });
    await f.dispatch(); await f.dispatch(); expect(f.sender).toHaveBeenCalledTimes(1);
    f.advance(30_000); await f.dispatch(); expect(f.sender).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 6; i++) { f.advance(3_600_000); await f.dispatch(); }
    expect(f.sender).toHaveBeenCalledTimes(5); expect(f.db.sqlite.prepare("SELECT state FROM push_deliveries").get()?.state).toBe("exhausted");
  });
  it("stops retrying a reminder completed after a failed send", async () => {
    const f = setup(); f.sender.mockRejectedValue({ statusCode: 429 }); await f.dispatch(); f.advance(30_000); f.isTaskOpen.mockResolvedValue(false); await f.dispatch(); expect(f.sender).toHaveBeenCalledTimes(1);
  });
  it("keeps durable accepted/leased outcomes across a real database reopen", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "taesks-push-")); directories.push(directory); const filename = path.join(directory, "test.db");
    const f = setup(filename); await f.dispatch(); f.db.sqlite.close();
    const reopened = openDatabase(filename); databases.push(reopened); const store = createPushStore(reopened);
    expect(store.canAttempt(store.subscriptions()[0].id, taskId, new Date(instant).toISOString(), instant)).toBe(false);
    const at = new Date(instant + 1).toISOString(); const id = store.subscriptions()[0].id;
    expect(store.claim(id, taskId, at, instant)).toBe(true);
    expect(store.claim(id, taskId, at, instant + 1)).toBe(false);
    expect(store.claim(id, taskId, at, instant + PUSH_LEASE_MS)).toBe(true);
  });
  it("does not delete a replacement after an old in-flight endpoint expires", async () => {
    const f = setup(); const previous = f.store.subscriptions()[0]; f.store.register(token, subscription("replacement")); f.store.finish(previous, taskId, new Date(instant).toISOString(), instant, 410, false); expect(f.store.subscriptions()[0].endpoint).toContain("replacement");
  });
  it("serializes overlapping runs", async () => {
    const f = setup(); let release!: () => void;
    f.isTaskOpen.mockImplementation(() => new Promise(resolve => { release = () => resolve(true); }));
    const first = f.dispatch(); await f.dispatch(); release(); await first; expect(f.sender).toHaveBeenCalledTimes(1);
  });
  it("does not starve other tasks behind a batch of unknown statuses", async () => {
    const f = setup();
    for (let i = 2; i <= 22; i++) f.db.sqlite.prepare("INSERT INTO task_metadata(notion_task_id,reminder_at,created_at,updated_at) VALUES(?,?,?,?)").run(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, new Date(instant).toISOString(), "now", "now");
    f.isTaskOpen.mockImplementation(async id => { if (id.endsWith("000022")) return true; throw new Error("Unknown"); });
    await f.dispatch(); await f.dispatch(); expect(f.sender).toHaveBeenCalledTimes(1);
  });
});
