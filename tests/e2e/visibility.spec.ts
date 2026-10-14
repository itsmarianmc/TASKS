import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { workspace, navigate, capture, makeTask } from "./workspace.fixture";

test("Overview and Settings share immediate, persistent display preferences", async ({ page }) => {
  const state = await workspace(page);
  await navigate(page, "Overview");
  await expect(page.locator('.task-row[data-task-id="done"] .task-check')).toHaveText("[✓]");
  await page.getByRole("checkbox", { name: "completed", exact: true }).click();
  await expect(page.locator('.task-row[data-task-id="done"]')).toHaveCount(0);
  await page.getByRole("checkbox", { name: "active projects only", exact: true }).click();
  await expect(page.locator(".desktop-sidebar .nav-row.indented").filter({ hasText: "Shared" })).toHaveCount(0);
  await navigate(page, "Settings");
  await expect(page.getByRole("checkbox", { name: "Show completed tasks", exact: true })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Hide projects without active tasks", exact: true })).toBeChecked();
  await expect.poll(() => state.local.preferences.showCompletedTasks).toBe(false);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Hide projects without active tasks", exact: true })).toBeChecked();
  await page.getByRole("checkbox", { name: "Show completed tasks", exact: true }).click();
  await navigate(page, "Overview");
  await expect(page.getByRole("checkbox", { name: "completed", exact: true })).toBeChecked();
  await expect(page.locator('.task-row[data-task-id="done"]')).toBeVisible();
  await page.getByRole("checkbox", { name: "active projects only", exact: true }).click();
  await expect(page.locator(".desktop-sidebar .nav-row.indented").filter({ hasText: "Shared" })).toHaveCount(2);
});

test("active zero-count project remains until navigation and hidden projects/tasks remain searchable", async ({ page }) => {
  const state = await workspace(page);
  state.graph.tasks.push(makeTask("shared-task", "Shared current task", undefined, undefined, { projectId: "shared", areaId: "work" }));
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await navigate(page, "Overview");
  await page.getByRole("checkbox", { name: "active projects only", exact: true }).click();
  await expect(page.locator(".desktop-sidebar .area-tree").filter({ hasText: "Homework" }).locator(".nav-row.indented").filter({ hasText: "Shared" })).toHaveCount(0);
  await navigate(page, "Work / Shared");
  await page.getByRole("checkbox", { name: "Complete Shared current task", exact: true }).press("Space");
  const active = page.locator(".desktop-sidebar .nav-row.active");
  await expect(active).toContainText("Shared"); await expect(active.locator(".nav-count")).toHaveText("0");
  await expect(page.locator('.task-row[data-task-id="shared-task"] .task-check')).toHaveText("[✓]");
  await navigate(page, "Overview");
  await expect(page.locator(".desktop-sidebar .nav-row.indented").filter({ hasText: "Shared" })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "completed", exact: true }).click();
  await navigate(page, "Shared current task");
  await expect(page.locator(".task-drawer")).toContainText("completed");
  await page.keyboard.press("Escape"); await expect(page.locator(".task-drawer")).toHaveCount(0);
  await navigate(page, "Work / Shared"); await expect(page.locator("h1")).toContainText("Shared");
});

test("drawer animates both ways, stays mounted during task switching and autosaves fields", async ({ page, isMobile }) => {
  const state = await workspace(page);
  await page.locator('.task-content[data-task-id="now"]').click();
  const drawer = page.locator(".task-drawer");
  await expect(drawer).toHaveCSS("animation-name", "task-drawer-in");
  await expect(drawer.locator("input[type=checkbox]")).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "Save task" })).toHaveCount(0);
  await expect(drawer.locator(".localized-date").first()).toContainText("03.10.2026");
  await drawer.getByLabel("Task title", { exact: true }).fill("Automatically saved title");
  await drawer.getByLabel("Task title", { exact: true }).blur();
  await expect.poll(() => state.patches.some(patch => patch.body.task?.title === "Automatically saved title")).toBe(true);
  await drawer.locator(".local-scheduling summary").click();
  await drawer.getByRole("checkbox", { name: "Someday", exact: true }).click();
  await expect.poll(() => state.local.metadata.find(meta => meta.taskId === "now")?.someday).toBe(true);
  if (!isMobile) {
    await drawer.evaluate(element => element.setAttribute("data-mounted-test", "same"));
    await page.locator('.task-content[data-task-id="overdue"]').click();
    await expect(drawer).toHaveAttribute("data-mounted-test", "same");
    await expect(drawer.getByLabel("Task title", { exact: true })).toHaveValue("Overdue essay");
  } else {
    expect(await drawer.evaluate(element => element.getBoundingClientRect().width)).toBe(page.viewportSize()!.width);
  }
  await drawer.getByRole("button", { name: "Close", exact: true }).click();
  await expect(drawer).toHaveAttribute("data-state", "closed");
  await expect(drawer).toHaveCSS("animation-name", "task-drawer-out");
  await expect(drawer).toHaveCount(0);
});

test("reduced-motion drawer and Escape close without an animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await workspace(page); await page.locator('.task-content[data-task-id="now"]').click();
  await expect(page.locator(".task-drawer")).toHaveCSS("animation-name", "none");
  await page.keyboard.press("Escape"); await expect(page.locator(".task-drawer")).toHaveCount(0);
});

test("failed preference persistence retains the session choice without refetching tasks", async ({ page }) => {
  await workspace(page); await navigate(page, "Overview");
  let graphReads = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/graph") graphReads++; });
  await page.route("**/api/local", route => {
    const body = route.request().method() === "POST" ? route.request().postDataJSON() : null;
    return body?.action === "setPreferences" && typeof body.patch?.showCompletedTasks === "boolean"
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "TEST_FAILURE", message: "Not saved" } }) })
      : route.fallback();
  });
  await page.getByRole("checkbox", { name: "completed", exact: true }).click();
  await expect(page.locator('.task-row[data-task-id="done"]')).toHaveCount(0);
  await expect(page.locator(".mutation-toast")).toContainText("Couldn't save preferences.");
  await expect(page.getByRole("checkbox", { name: "completed", exact: true })).not.toBeChecked();
  expect(graphReads).toBe(0); await expect(page.locator(".loading-line")).toHaveCount(0);
  await navigate(page, "Settings"); await expect(page.getByRole("checkbox", { name: "Show completed tasks", exact: true })).not.toBeChecked();
});

test("German Quick Add and all requested desktop/mobile views have visual evidence", async ({ page, isMobile }) => {
  const state = await workspace(page);
  await page.clock.setFixedTime(new Date("2026-10-04T12:00:00Z"));
  state.graph.projects[0].name = "Englisch"; state.graph.areas[0].name = "Hausaufgaben";
  state.graph.tasks.find(task => task.id === "done")!.dates.end = "2026-10-04";
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await navigate(page, "Overview");
  const prefix = isMobile ? "mobile" : "desktop", directory = "test-results/visibility-screenshots";
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${prefix}-overview-completed-on.png`, fullPage: true, animations: "disabled" });
  await page.getByRole("checkbox", { name: "completed", exact: true }).click();
  await page.screenshot({ path: `${directory}/${prefix}-overview-completed-off.png`, fullPage: true, animations: "disabled" });
  await page.getByRole("checkbox", { name: "active projects only", exact: true }).click();
  await page.screenshot({ path: `${directory}/${prefix}-sidebar-filter-on.png`, fullPage: true, animations: "disabled" });
  if (isMobile) {
    await page.locator(".mobile-back").click();
    await page.screenshot({ path: `${directory}/${prefix}-filtered-lists.png`, fullPage: true, animations: "disabled" });
    await page.locator(".mobile-list-root .nav-row").filter({ hasText: "Overview" }).click();
  }
  await page.getByRole("checkbox", { name: "active projects only", exact: true }).click();
  await page.screenshot({ path: `${directory}/${prefix}-sidebar-filter-off.png`, fullPage: true, animations: "disabled" });
  await navigate(page, "Settings");
  await page.getByRole("checkbox", { name: "Show completed tasks", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${directory}/${prefix}-settings-display.png`, fullPage: true, animations: "disabled" });
  await navigate(page, "Overview");
  let aiCalls = 0; page.on("request", request => { if (request.url().includes("/api/parse")) aiCalls++; });
  await capture(page, "Präsentation in Englisch bis übernächsten Freitag als Hausaufgabe");
  await expect(page.locator(".preview-title")).toHaveText("Präsentation");
  await expect(page.locator(".capture-preview")).toContainText("04.10. → 16.10.");
  await expect(page.locator(".capture-preview")).toContainText("$Englisch");
  await expect(page.locator(".capture-preview")).toContainText("@Hausaufgaben"); expect(aiCalls).toBe(0);
  await page.screenshot({ path: `${directory}/${prefix}-quick-add.png`, fullPage: true, animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.locator('.task-content[data-task-id="now"]').click();
  await page.screenshot({ path: `${directory}/${prefix}-inspector-open.png`, fullPage: true, animations: "disabled" });
  await page.locator(".task-drawer").getByRole("button", { name: "✓ complete", exact: true }).click();
  await expect(page.locator(".task-drawer")).toContainText("completed");
  await page.screenshot({ path: `${directory}/${prefix}-inspector-completed.png`, fullPage: true, animations: "disabled" });
  expect(state.graph.tasks.find(task => task.id === "now")?.completed).toBe(true);
});
