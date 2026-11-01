import { expect, it } from "vitest";
import { refreshArrivals } from "@/lib/refresh-arrivals";
import type { Task } from "@/lib/types";
const task = (id: string) => ({ id }) as Task;
it("marks only new visible stable IDs once, excluding updated/reordered and optimistic tasks", () => {
  const animated = new Set<string>(); const before = new Set(["old", "updated"]);
  const after = [task("updated"), task("new"), task("old"), task("other-view"), { ...task("temp"), syncState: "creating" as const }];
  expect(refreshArrivals(before, after, [task("new"), task("updated"), task("temp")], animated)).toEqual(["new"]);
  expect(refreshArrivals(before, after, [task("new")], animated)).toEqual([]);
});
