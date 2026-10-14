import "server-only";
import { createHash } from "node:crypto";
import webPush from "web-push";
import { pushSubscriptionSchema } from "@/lib/push-contracts";
import { getDatabase } from "./db";
import { notion } from "./notion-service";
import { pushConfig } from "./push-config";
import { createPushStore, type StoredPushSubscription } from "./push-store";

export type ReminderPush = { type: "reminder"; taskId: string; reminderAt: string; tag: string };
type Sender = (subscription: StoredPushSubscription, payload: ReminderPush) => Promise<void>;
export function createPushDispatcher(options: {
  store: ReturnType<typeof createPushStore>; configured: () => boolean;
  isTaskOpen: (id: string) => Promise<boolean>; send: Sender; now?: () => number;
}) {
  let running = false;
  let cursor = 0;
  const clock = options.now || Date.now;
  return async function dispatch() {
    if (running || !options.configured()) return { sent: 0, failed: 0, unverified: 0 };
    running = true;
    const result = { sent: 0, failed: 0, unverified: 0 };
    try {
      const { store } = options;
      store.prune(clock());
      const subscriptions = store.subscriptions();
      const jobs = store.due(clock()).flatMap(reminder => subscriptions.filter(subscription => store.canAttempt(subscription.id, reminder.taskId, reminder.reminderAt, clock())).map(subscription => ({ reminder, subscription })));
      const start = jobs.length ? cursor % jobs.length : 0;
      for (let offset = 0; offset < Math.min(20, jobs.length); offset++) {
          const index = (start + offset) % jobs.length;
          cursor = (index + 1) % jobs.length;
          const { reminder, subscription } = jobs[index];
          if (!pushSubscriptionSchema.safeParse({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }).success) continue;
          let open: boolean;
          try { open = await options.isTaskOpen(reminder.taskId); }
          catch { result.unverified++; continue; }
          // No await between the final local check, durable claim and sender invocation.
          if (!open || !options.configured() || !store.eligible(reminder.taskId, reminder.reminderAt, clock()) || !store.current(subscription)) continue;
          if (!store.claim(subscription.id, reminder.taskId, reminder.reminderAt, clock())) continue;
          const reminderAt = new Date(reminder.reminderAt).toISOString();
          const payload: ReminderPush = { type: "reminder", taskId: reminder.taskId, reminderAt, tag: `taesks-${createHash("sha256").update(`${reminder.taskId}:${reminderAt}`).digest("base64url")}` };
          try {
            await options.send(subscription, payload);
            store.finish(subscription, reminder.taskId, reminder.reminderAt, clock(), 201, true); result.sent++;
          } catch (error) {
            const status = error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : null;
            store.finish(subscription, reminder.taskId, reminder.reminderAt, clock(), status, false); result.failed++;
          }
      }
      return result;
    } finally { running = false; }
  };
}

const pushGlobal = globalThis as typeof globalThis & { taesksPushStarted?: boolean };
export function startPushDispatcher() {
  if (pushGlobal.taesksPushStarted || process.env.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build" || !pushConfig().public.available) return;
  pushGlobal.taesksPushStarted = true;
  let dispatch: ReturnType<typeof createPushDispatcher> | undefined;
  const tick = async () => {
    try {
      dispatch ??= createPushDispatcher({
        store: createPushStore(getDatabase()), configured: () => pushConfig().public.available,
        isTaskOpen: async id => (await notion()).isReminderTaskOpen(id),
        send: async (subscription, payload) => {
          const { vapid } = pushConfig();
          if (!vapid) throw new Error("Push configuration unavailable");
          await webPush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(payload), { vapidDetails: vapid, TTL: 300, urgency: "normal", timeout: 10_000 });
        },
      });
      const result = await dispatch();
      if (result.failed || result.unverified) console.warn(JSON.stringify({ source: "taesks.push", ...result }));
    } catch { console.error(JSON.stringify({ source: "taesks.push", code: "DISPATCH_FAILED" })); }
    // Schedule after completion, avoiding overlap and an accumulating timer queue.
    const timer = setTimeout(() => { void tick(); }, 30_000); timer.unref?.();
  };
  const timer = setTimeout(() => { void tick(); }, 5_000); timer.unref?.();
}
