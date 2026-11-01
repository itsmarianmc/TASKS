import type { Task } from "./types";
export function refreshArrivals(before: ReadonlySet<string>, after: readonly Task[], visible: readonly Task[], animated: Set<string>): string[] {
  const received = new Set(after.filter(task => !before.has(task.id) && !task.syncState).map(task => task.id));
  return visible.filter(task => received.has(task.id) && !animated.has(task.id)).map(task => { animated.add(task.id); return task.id; });
}
