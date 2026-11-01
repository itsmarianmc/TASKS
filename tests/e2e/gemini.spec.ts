import { expect, test, type Page } from "@playwright/test";
import { capture, workspace } from "./workspace.fixture";
import { parseQuickAdd } from "../../src/lib/parser";

async function enabledWorkspace(page: Page) {
  const state = await workspace(page);
  await page.route("**/api/config", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    timezone: "Europe/Berlin", maxUploadBytes: 20971520, appName: "TÆSKS",
    aiFallback: { provider: "Gemini", model: "gemini-3.5-flash-lite", enabled: true, status: "ready", confidenceThreshold: 0.75 },
  }) }));
  await page.reload(); await expect(page.locator("h1")).toContainText("Today");
  return state;
}
function reply(input: string, title: string) {
  return { fallback: "accepted", result: { input, title, projectId: "english", areaId: "homework", dates: { start: "2026-10-03", end: "2026-10-05" }, tags: [], priority: "none", recurrenceRule: null, confidence: 0.93, warnings: [], valid: true, needsResolution: false } };
}
test("clear tasks never call AI, including while typing and creating", async ({ page }) => {
  const state = await enabledWorkspace(page); let calls = 0;
  await page.route("**/api/parse", route => { calls++; return route.abort(); });
  await capture(page, "Make Presentation in English as Homework until Friday");
  const dialog = page.getByRole("dialog", { name: "Quick add", exact: true });
  await expect(dialog.getByRole("button", { name: "Understand input" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(dialog).toContainText("Synced to Notion");
  expect(calls).toBe(0); expect(state.creates).toHaveLength(1);
});
test("AI runs once on explicit action, then waits for confirmation before creating", async ({ page }) => {
  const state = await enabledWorkspace(page); let calls = 0;
  let release: (() => void) | undefined;
  await page.route("**/api/parse", async route => {
    calls++; const { input } = route.request().postDataJSON();
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(reply(input, "Finish presentation")) });
  });
  await capture(page, "Need to finally finish English homework before school on Monday");
  const dialog = page.getByRole("dialog", { name: "Quick add", exact: true });
  await expect(dialog.getByRole("button", { name: "Understand input" })).toBeVisible();
  expect(calls).toBe(0);
  await dialog.getByRole("textbox", { name: "Task input" }).press("Enter");
  await expect(dialog.getByRole("status")).toHaveText("understanding…");
  await dialog.getByRole("textbox", { name: "Task input" }).press("Enter");
  expect(calls).toBe(1); expect(state.creates).toHaveLength(0); release?.();
  await expect(dialog.locator(".preview-title")).toHaveText("Finish presentation");
  expect(state.creates).toHaveLength(0); await expect(dialog).not.toContainText("Gemini");
  await dialog.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(dialog).toContainText("Synced to Notion"); expect(state.creates).toHaveLength(1); expect(calls).toBe(1);
});
test("failed inference retains deterministic fields and manual completion", async ({ page }) => {
  const state = await enabledWorkspace(page); let calls = 0;
  const text = "Read that chapter before school on Monday";
  const deterministic = parseQuickAdd(text, state.graph, [], { today: "2026-10-03", timezone: "Europe/Berlin" });
  await page.route("**/api/parse", route => { calls++; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ result: deterministic, fallback: "failed" }) }); });
  await capture(page, text);
  const dialog = page.getByRole("dialog", { name: "Quick add", exact: true });
  await dialog.getByRole("button", { name: "Understand input" }).click();
  await expect(dialog).toContainText("Couldn't infer all fields. Choose manually.");
  await expect(dialog.locator(".preview-title")).toHaveText(deterministic.title);
  await expect(dialog.getByRole("button", { name: "Create task", exact: true })).toBeDisabled();
  await dialog.getByLabel("Task project", { exact: true }).selectOption("english");
  await dialog.getByRole("button", { name: "Use edited fields" }).click();
  await dialog.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(dialog).toContainText("Synced to Notion"); expect(state.creates).toHaveLength(1); expect(calls).toBe(1);
});
test("editing during a request ignores stale results and permits a new parse", async ({ page }) => {
  const state = await enabledWorkspace(page);
  let releaseFirst: (() => void) | undefined; let calls = 0;
  await page.route("**/api/parse", async route => {
    calls++; const { input } = route.request().postDataJSON(); const first = calls === 1;
    if (first) await new Promise<void>(resolve => { releaseFirst = resolve; });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(reply(input, first ? "STALE RESULT" : "Second result")) }).catch(() => {});
  });
  await capture(page, "First unfinished sentence before school on Monday");
  const dialog = page.getByRole("dialog", { name: "Quick add", exact: true });
  await dialog.getByRole("button", { name: "Understand input" }).click();
  await expect(dialog.getByRole("status")).toHaveText("understanding…");
  await dialog.getByRole("textbox", { name: "Task input" }).fill("Second unfinished sentence before school on Monday");
  await dialog.getByRole("button", { name: "Understand input" }).click();
  await expect(dialog.locator(".preview-title")).toHaveText("Second result");
  releaseFirst?.();
  await expect(dialog.locator(".preview-title")).toHaveText("Second result");
  await expect(dialog).not.toContainText("STALE RESULT"); expect(calls).toBe(2); expect(state.creates).toHaveLength(0);
});
