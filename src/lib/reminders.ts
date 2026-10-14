import type { Graph, LocalSnapshot } from "./types";
export function dueReminders(graph: Graph, local: LocalSnapshot, now: number) {
  return local.metadata.filter(metadata => metadata.reminderAt && !metadata.reminderDismissedAt && Number.isFinite(Date.parse(metadata.reminderAt)) && Date.parse(metadata.reminderAt) <= now && !graph.tasks.find(task => task.id === metadata.taskId)?.completed);
}
export function toDeviceDateTime(instant: string | null) {
  if (!instant) return ""; const date = new Date(instant); if (Number.isNaN(date.valueOf())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
/** Round-trip rejects invalid dates and DST gaps instead of silently shifting wall time. */
export function parseDeviceReminder(value: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Choose a valid reminder date and time.");
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()) || toDeviceDateTime(date.toISOString()) !== value) throw new Error("This reminder time does not exist in your device timezone. Choose another time.");
  for (const delta of [30, 60, 90, 120]) if (toDeviceDateTime(new Date(date.valueOf() + delta * 60_000).toISOString()) === value) throw new Error("This reminder time occurs twice during the timezone change. Choose an unambiguous time.");
  return date.toISOString();
}
export function reminderSchedulingPatch(value: string, original: string | null) {
  return value === toDeviceDateTime(original) ? {} : { reminderAt: parseDeviceReminder(value), reminderDismissedAt: null };
}
export function snoozeReminder(now: number, minutes = 10) { return { reminderAt: new Date(now + minutes * 60_000).toISOString(), reminderDismissedAt: null }; }
