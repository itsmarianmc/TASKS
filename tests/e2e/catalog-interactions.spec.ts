import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { workspace as fixtureWorkspace, makeTask, navigate, capture, today } from "./workspace.fixture";

async function workspace(page: Page, github = false, contact = false, open = true) {
  const state = await fixtureWorkspace(page, github, contact, false);
  if ((page.viewportSize()?.width ?? 1024) <= 760) state.local.preferences.sidebarCollapsed = true;
  if (open) { await page.goto("/?view=today"); await expect(page.locator("h1")).toHaveText(/Today/); await expect(page.locator(".boot-screen")).toHaveCount(0); }
  return state;
}

test("manual refresh animates only new visible IDs once", async ({ page }) => {
  const state = await workspace(page);
  expect(await page.locator(".task-arrival").count()).toBe(0);
  // Capture animation starts, since the class is intentionally short lived.
  await page.evaluate(() => {
    (window as unknown as { arrivals: string[] }).arrivals = [];
    document.addEventListener("animationstart", event => {
      const animation = event as AnimationEvent;
      if (animation.animationName === "task-arrive") (window as unknown as { arrivals: string[] }).arrivals.push((event.target as HTMLElement).dataset.taskId!);
    });
  });
  state.graph.tasks.push(makeTask("arrived", "Arrived after refresh", today, today));
  state.graph.tasks.find(task => task.id === "now")!.title = "Updated existing task";
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(page.locator('[data-task-id="arrived"].task-row')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { arrivals: string[] }).arrivals)).toEqual(["arrived"]);
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(page.locator(".task-arrival")).toHaveCount(0);
  await navigate(page, "Next 7 days");
  expect(await page.evaluate(() => (window as unknown as { arrivals: string[] }).arrivals)).toEqual(["arrived"]);
});

test("refresh arrivals use refreshed local metadata in a saved filter", async ({ page }) => {
  const state = await workspace(page, false, false, false);
  state.local.filters.push({ id: "focus", name: "Focus", criteria: { tagIds: ["school"] }, createdAt: "2026-10-03T12:00:00Z", updatedAt: "2026-10-03T12:00:00Z" });
  await page.goto("/?view=filter%3Afocus");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await page.evaluate(() => {
    (window as unknown as { arrivals: string[] }).arrivals = [];
    document.addEventListener("animationstart", event => { if ((event as AnimationEvent).animationName === "task-arrive") (window as unknown as { arrivals: string[] }).arrivals.push((event.target as HTMLElement).dataset.taskId!); });
  });
  state.graph.tasks.push(makeTask("tagged-arrival", "Tagged arrival", today, today));
  state.local.taskTags.push({ taskId: "tagged-arrival", tagId: "school" });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/local", async route => {
    if (route.request().method() === "GET") await held;
    await route.fallback();
  });
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(page.locator('.task-row[data-task-id="tagged-arrival"]')).toHaveCount(0);
  release();
  await expect(page.locator('.task-row[data-task-id="tagged-arrival"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { arrivals: string[] }).arrivals)).toEqual(["tagged-arrival"]);
});

test("polls, overlapping refreshes, navigation and reduced motion do not replay arrivals", async ({ page }) => {
  const state = await workspace(page);
  state.graph.tasks.push(makeTask("background", "Background arrival", today, today));
  await page.clock.fastForward(15_100);
  await expect(page.locator('.task-row[data-task-id="background"]')).toBeVisible();
  await expect(page.locator(".task-arrival")).toHaveCount(0);
  let release!: () => void, refreshes = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/graph?refresh=1", async route => {
    refreshes++; await held;
    await route.fulfill({ json: { graph: state.graph, completionEnabled: true, diagnostics: [] } });
  });
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect.poll(() => refreshes).toBe(1);
  await page.keyboard.press("r");
  await navigate(page, "Next 7 days");
  state.graph.tasks.push(makeTask("navigated", "New task during navigation", today, today));
  release();
  await expect(page.locator('.task-row[data-task-id="navigated"]')).toBeVisible();
  await expect(page.locator(".task-arrival")).toHaveCount(0);
  expect(refreshes).toBe(1);
  await page.unroute("**/api/graph?refresh=1");
  await page.emulateMedia({ reducedMotion: "reduce" });
  state.graph.tasks.push(makeTask("reduced", "Reduced motion arrival", today, today));
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(page.locator('.task-row[data-task-id="reduced"]')).toHaveCSS("animation-name", "none");
});

test("completion Undo survives a removed row and waits for pending writes", async ({ page }) => {
  const state = await workspace(page);
  state.local.preferences.showCompletedTasks = false;
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const writes: boolean[] = [];
  await page.route("**/api/tasks/now", async route => {
    const body = route.request().postDataJSON(); writes.push(body.completed);
    if (body.completed) await pending;
    const task = state.graph.tasks.find(task => task.id === "now")!;
    task.completed = body.completed;
    await route.fulfill({ json: { task, warnings: [], snapshot: state.local } });
  });
  await page.getByRole("checkbox", { name: "Complete Review presentation", exact: true }).click();
  await expect(page.locator('.task-row[data-task-id="now"]')).toHaveCount(0);
  const toast = page.locator('[data-completion-id="now"]');
  await expect(toast).toContainText("Saving completion…");
  await toast.getByRole("button", { name: "Undo", exact: true }).click();
  expect(writes).toEqual([true]); release();
  await expect.poll(() => writes).toEqual([true, false]);
  await expect(page.locator('.task-row[data-task-id="now"]')).toBeVisible();
  await expect(toast).toHaveCount(0);
});

test("confirmed completion and reopening have equivalent Undo; failures never show success", async ({ page }) => {
  const state = await workspace(page);
  await page.getByRole("checkbox", { name: "Complete Review presentation", exact: true }).click();
  const toast = page.locator('[data-completion-id="now"]');
  await expect(toast).toContainText("Task completed");
  await toast.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Complete Review presentation", exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Reopen Completed reading", exact: true }).click();
  const reopened = page.locator('[data-completion-id="done"]');
  await expect(reopened).toContainText("Task reopened");
  await reopened.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => state.patches.filter(patch => patch.id === "done").map(patch => patch.body.completed)).toEqual([false, true]);
  await page.route("**/api/tasks/now", route => route.fulfill({ status: 502, json: { error: { code: "NOTION_UNAVAILABLE", message: "Completion refused", correlationId: "fixture" } } }));
  await page.getByRole("checkbox", { name: "Complete Review presentation", exact: true }).click();
  await expect(page.locator('.mutation-toasts')).toContainText("Couldn't complete task.");
  await expect(toast).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Complete Review presentation", exact: true })).toBeVisible();
});

test("manual dates reject an extra year digit in both shared fields without crashing or saving it", async ({ page }) => {
  const state = await workspace(page); const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  state.graph.tasks.find(task => task.id === "now")!.dates.end = "2029-12-31";
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await page.locator('.task-content[data-task-id="now"]').click();
  for (const label of ["Task start", "Task deadline"]) {
    const field = page.getByLabel(label, { exact: true });
    await field.fill("2026-10-31"); await field.blur();
    await expect.poll(() => state.patches.length).toBeGreaterThan(0);
    await field.fill("20261-10-31");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await page.getByRole("heading", { name: "Review presentation" }).click();
    expect(state.patches.every(patch => !JSON.stringify(patch.body).includes("20261"))).toBe(true);
    await field.fill("2028-02-29");
    await expect(field).not.toHaveAttribute("aria-invalid", "true");
    await field.fill("");
    await expect(field).toHaveValue("");
  }
  await page.getByLabel("Task deadline", { exact: true }).blur();
  await expect.poll(() => state.patches.some(patch => patch.body.task?.dates?.start === null && patch.body.task?.dates?.end === null)).toBe(true);
  expect(errors).toEqual([]);
});

test("language catalogs translate labels and Undo while user titles remain literal; selection persists", async ({ page }) => {
  const state = await workspace(page, false, false, false);
  state.local.preferences.language = "de";
  const { strings } = JSON.parse(readFileSync(new URL("../../public/locales/en/language.json", import.meta.url), "utf8")) as { strings: Record<string, string> };
  const keyFor = (english: string) => Object.entries(strings).find(([, value]) => value === english)![0];
  const translations = Object.fromEntries([ ["Today", "Heute"], ["Settings & diagnostics", "Einstellungen"], ["Settings", "Einstellungen"], ["Language", "Sprache"], ["Quick add", "Schnell hinzufügen"], ["Task input", "Aufgabe eingeben"] ].map(([english, translated]) => [keyFor(english), translated]));
  await page.route("**/api/config", route => route.fulfill({ json: { timezone: "Europe/Berlin", maxUploadBytes: 20971520, appName: "TÆSKS", preferredLanguages: ["de-DE"], catalogs: { languages: [{ schemaVersion: 1, lang: "de", name: "German", locName: "Deutsch", strings: { ...translations, "common.undo": "Rückgängig", "completion.completed": "Aufgabe erledigt" } }], dates: [], diagnostics: [] } } }));
  await page.goto("/?view=today");
  // Fixture catalogs replace server configuration through the existing config query.
  await expect(page.locator("h1")).toContainText("Heute");
  await expect(page.locator('.task-content[data-task-id="now"]')).toContainText("Review presentation");
  await page.getByRole("checkbox", { name: "Complete Review presentation", exact: true }).click();
  await expect(page.locator('[data-completion-id="now"]')).toContainText("Aufgabe erledigt");
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await navigate(page, "Einstellungen");
  const language = page.getByRole("combobox", { name: "Sprache", exact: true });
  await expect(language).toHaveValue("de");
  await language.selectOption("de");
  await expect.poll(() => state.local.preferences.language).toBe("de");
  await page.reload(); await expect(page.locator("h1")).toContainText("Einstellungen");
});

test("quoted-text setting defaults on for old preferences and changes preview parsing", async ({ page }) => {
  await workspace(page);
  await capture(page, 'Read "tomorrow #English @Homework [focus] high priority every 2 weeks"');
  await expect(page.locator(".preview-title")).toHaveText('Read "tomorrow #English @Homework [focus] high priority every 2 weeks"');
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await navigate(page, "Settings & diagnostics");
  await page.getByRole("checkbox", { name: "Treat quoted text as literal", exact: true }).click();
  await page.keyboard.press("n");
  await expect(page.locator(".preview-title")).not.toContainText("tomorrow");
  await expect(page.locator(".capture-preview")).toContainText("English");
});
