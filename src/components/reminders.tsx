"use client";
import { useEffect, useEffectEvent, useState } from "react";
import type { Graph, LocalSnapshot } from "@/lib/types";
import { dueReminders, snoozeReminder } from "@/lib/reminders";
import { deliverReminderOnce } from "@/lib/reminder-delivery";
import { useLocalMutation } from "@/lib/queries";
import { hasConfirmedPush, usePushRegistered } from "@/lib/push-client";


export function ReminderList({ graph, local, onOpen }: { graph: Graph; local: LocalSnapshot; onOpen: (id: string) => void }) {
  const [now, setNow] = useState(() => Date.now()); const mutation = useLocalMutation();
  const pushRegistered = usePushRegistered();
  const reminders = dueReminders(graph, local, now); const open = useEffectEvent(onOpen);
  useEffect(() => { const tick = () => setNow(Date.now()); const interval = setInterval(tick, 15_000); window.addEventListener("focus", tick); return () => { clearInterval(interval); window.removeEventListener("focus", tick); }; }, []);
  useEffect(() => {
    const id = new URL(location.href).searchParams.get("reminder"); if (id) { open(id); const url = new URL(location.href); url.searchParams.delete("reminder"); history.replaceState(null, "", url); }
    if (!("serviceWorker" in navigator)) return;
    const message = (event: MessageEvent) => { if (event.data?.type === "open-reminder" && typeof event.data.taskId === "string") open(event.data.taskId); };
    navigator.serviceWorker.addEventListener("message", message); return () => navigator.serviceWorker.removeEventListener("message", message);
  }, []);
  useEffect(() => {
    if (pushRegistered || hasConfirmedPush() || !window.isSecureContext || !("Notification" in window) || Notification.permission !== "granted") return;
    for (const reminder of dueReminders(graph, local, now)) {
      const task = graph.tasks.find(task => task.id === reminder.taskId); const key = `${reminder.taskId}:${reminder.reminderAt}`;
      void deliverReminderOnce(key, async () => {
        const options: NotificationOptions = { body: task?.title ?? "Open saved task context", tag: key, icon: "/icons/icon-192.png", data: { taskId: reminder.taskId } };
        const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
        if (hasConfirmedPush()) return;
        if (registration?.active) await registration.showNotification("TÆSKS / reminder", options);
        else { const notification = new Notification("TÆSKS / reminder", options); notification.onclick = () => { window.focus(); open(reminder.taskId); notification.close(); }; }
      }).catch(() => { /* A failed delivery keeps the in-app reminder and no shown marker. */ });
    }
  }, [graph, local, now, pushRegistered]);
  if (!reminders.length) return null;
  return <section className="reminder-list" aria-label="Due reminders"><h2>reminders <span>{reminders.length}</span></h2>{reminders.map(reminder => <div className="reminder-row" key={`${reminder.taskId}:${reminder.reminderAt}`}><button className="text-button reminder-title" onClick={() => onOpen(reminder.taskId)}>{graph.tasks.find(task => task.id === reminder.taskId)?.title ?? `Local context / ${reminder.taskId}`}</button><span className="muted">{new Date(reminder.reminderAt!).toLocaleString()}</span><button className="text-button"  onClick={() => mutation.mutate({ action: "setTaskMetadata", taskId: reminder.taskId, patch: snoozeReminder(Date.now()) })}>Snooze 10 min</button><button className="text-button"  onClick={() => mutation.mutate({ action: "setTaskMetadata", taskId: reminder.taskId, patch: { reminderDismissedAt: new Date().toISOString() } })}>Dismiss</button></div>)}</section>;
}

