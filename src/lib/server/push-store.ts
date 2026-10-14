import "server-only";
import { createHash, ECDH, randomUUID } from "node:crypto";
import type { PushSubscriptionData } from "@/lib/push-contracts";
import { pushDeviceTokenSchema, pushSubscriptionSchema } from "@/lib/push-contracts";
import type { LocalDatabase } from "./db";
import { AppError } from "./http";

export type StoredPushSubscription = { id: string; endpoint: string; p256dh: string; auth: string };
export const PUSH_CATCH_UP_MS = 24 * 60 * 60 * 1000;
export const PUSH_LEASE_MS = 5 * 60 * 1000;
export const PUSH_MAX_ATTEMPTS = 5;
export function createPushStore({ sqlite }: LocalDatabase) {
  const hash = (token: string) => createHash("sha256").update(pushDeviceTokenSchema.parse(token)).digest("hex");
  function register(token: string, input: PushSubscriptionData) {
    const subscription = pushSubscriptionSchema.parse(input); const deviceHash = hash(token);
    try { ECDH.convertKey(Buffer.from(subscription.keys.p256dh, "base64url"), "prime256v1"); }
    catch { throw new AppError("PUSH_KEY", "The browser subscription key is invalid."); }
    if (subscription.expirationTime != null && subscription.expirationTime <= Date.now()) throw new AppError("PUSH_EXPIRED", "This browser subscription has expired. Reset it and retry.");
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      const owner = sqlite.prepare("SELECT device_hash FROM web_push_subscriptions WHERE endpoint=?").get(subscription.endpoint);
      if (owner && owner.device_hash !== deviceHash) throw new AppError("PUSH_OWNER", "This subscription belongs to another installation. Reset this device's browser subscription.", 409);
      const existing = sqlite.prepare("SELECT id FROM web_push_subscriptions WHERE device_hash=?").get(deviceHash);
      if (!existing && Number(sqlite.prepare("SELECT count(*) AS count FROM web_push_subscriptions").get()?.count) >= 256) throw new AppError("PUSH_LIMIT", "The server's installation limit has been reached.", 409);
      sqlite.prepare("INSERT INTO web_push_subscriptions(id,endpoint,p256dh,auth,created_at,device_hash) VALUES(?,?,?,?,?,?) ON CONFLICT(device_hash) DO UPDATE SET endpoint=excluded.endpoint,p256dh=excluded.p256dh,auth=excluded.auth")
        .run(existing?.id || randomUUID(), subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, new Date().toISOString(), deviceHash);
      sqlite.exec("COMMIT");
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  }
  function status(token: string, endpoint: string) { return !!sqlite.prepare("SELECT id FROM web_push_subscriptions WHERE device_hash=? AND endpoint=?").get(hash(token), endpoint); }
  function revoke(token: string) { sqlite.prepare("DELETE FROM web_push_subscriptions WHERE device_hash=?").run(hash(token)); }
  function subscriptions() { return sqlite.prepare("SELECT id,endpoint,p256dh,auth FROM web_push_subscriptions WHERE device_hash IS NOT NULL").all() as StoredPushSubscription[]; }
  function due(now: number) {
    return sqlite.prepare("SELECT notion_task_id AS taskId,reminder_at AS reminderAt FROM task_metadata WHERE reminder_at IS NOT NULL AND reminder_dismissed_at IS NULL ORDER BY reminder_at").all()
      .filter(row => Number.isFinite(Date.parse(String(row.reminderAt))) && Date.parse(String(row.reminderAt)) <= now && Date.parse(String(row.reminderAt)) >= now - PUSH_CATCH_UP_MS) as { taskId: string; reminderAt: string }[];
  }
  function eligible(taskId: string, reminderAt: string, now: number) {
    const row = sqlite.prepare("SELECT reminder_at,reminder_dismissed_at FROM task_metadata WHERE notion_task_id=?").get(taskId);
    return row?.reminder_at === reminderAt && row.reminder_dismissed_at === null && Date.parse(reminderAt) <= now && Date.parse(reminderAt) >= now - PUSH_CATCH_UP_MS;
  }
  function current(subscription: StoredPushSubscription) { return !!sqlite.prepare("SELECT id FROM web_push_subscriptions WHERE id=? AND endpoint=? AND p256dh=? AND auth=?").get(subscription.id, subscription.endpoint, subscription.p256dh, subscription.auth); }
  function canAttempt(subscriptionId: string, taskId: string, reminderAt: string, now: number) {
    const row = sqlite.prepare("SELECT state,attempts,next_attempt_at FROM push_deliveries WHERE subscription_id=? AND task_id=? AND reminder_at=?").get(subscriptionId, taskId, new Date(reminderAt).toISOString());
    return !row || ((row.state === "retry" || row.state === "sending") && Number(row.attempts) < PUSH_MAX_ATTEMPTS && Number(row.next_attempt_at) <= now);
  }
  function claim(subscriptionId: string, taskId: string, reminderAt: string, now: number) {
    const instant = new Date(reminderAt).toISOString();
    const result = sqlite.prepare(`INSERT INTO push_deliveries(subscription_id,task_id,reminder_at,state,attempts,next_attempt_at,updated_at)
      VALUES(?,?,?,'sending',1,?,?) ON CONFLICT(subscription_id,task_id,reminder_at) DO UPDATE SET
      state='sending',attempts=attempts+1,next_attempt_at=excluded.next_attempt_at,updated_at=excluded.updated_at
      WHERE state IN ('retry','sending') AND next_attempt_at<=? AND attempts<?`).run(subscriptionId, taskId, instant, now + PUSH_LEASE_MS, now, now, PUSH_MAX_ATTEMPTS);
    return result.changes === 1;
  }
  function finish(subscription: StoredPushSubscription, taskId: string, reminderAt: string, now: number, status: number | null, accepted: boolean) {
    if (status === 404 || status === 410) {
      // A response for an old endpoint must not delete a replacement subscription.
      sqlite.prepare("DELETE FROM web_push_subscriptions WHERE id=? AND endpoint=?").run(subscription.id, subscription.endpoint); return;
    }
    const instant = new Date(reminderAt).toISOString();
    const row = sqlite.prepare("SELECT attempts FROM push_deliveries WHERE subscription_id=? AND task_id=? AND reminder_at=?").get(subscription.id, taskId, instant);
    if (!row) return;
    const attempts = Number(row.attempts);
    const retryable = status === null || status === 429 || status >= 500;
    const state = accepted ? "accepted" : retryable && attempts < PUSH_MAX_ATTEMPTS ? "retry" : "exhausted";
    sqlite.prepare("UPDATE push_deliveries SET state=?,next_attempt_at=?,updated_at=?,last_status=? WHERE subscription_id=? AND task_id=? AND reminder_at=?")
      .run(state, now + Math.min(30_000 * 2 ** (attempts - 1), 30 * 60_000), now, status, subscription.id, taskId, instant);
  }
  function prune(now: number) {
    sqlite.prepare("UPDATE push_deliveries SET state='exhausted' WHERE state='sending' AND attempts>=? AND next_attempt_at<=?").run(PUSH_MAX_ATTEMPTS, now);
    sqlite.prepare("DELETE FROM push_deliveries WHERE updated_at<? AND NOT EXISTS(SELECT 1 FROM task_metadata WHERE notion_task_id=push_deliveries.task_id AND julianday(reminder_at)=julianday(push_deliveries.reminder_at) AND reminder_dismissed_at IS NULL)").run(now - 30 * PUSH_CATCH_UP_MS);
  }
  return { register, status, revoke, subscriptions, due, eligible, current, canAttempt, claim, finish, prune };
}
