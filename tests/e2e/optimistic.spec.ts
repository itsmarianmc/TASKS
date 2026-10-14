import { expect, test, type Page, type Route } from "@playwright/test";
import { capture, navigate, workspace } from "./workspace.fixture";

async function slowWrites(page: Page, matches: (route: Route) => boolean, failure = false, delay = 3000) {
  const requests: string[] = []; let settled = 0;
  await page.route("**/api/**", async route => {
    if (!matches(route)) return route.fallback();
    requests.push(route.request().url());
    await new Promise(resolve => setTimeout(resolve, delay));
    settled++;
    if (failure) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "TEST_FAILURE", message: "Raw backend detail must not be shown", correlationId: "optimistic-test" } }) });
    return route.fallback();
  });
  return { requests, settled: () => settled };
}
const taskWrite = (route: Route) => route.request().method() !== "GET" && new URL(route.request().url()).pathname.startsWith("/api/tasks");
const localWrite = (route: Route) => route.request().method() === "POST" && new URL(route.request().url()).pathname === "/api/local" && route.request().postDataJSON().action !== "setPreferences";
async function openTask(page: Page) { await page.locator('.task-row[data-task-id="now"] .task-content').click(); return page.locator(".inspector-dialog"); }

test("3000ms completion changes Today immediately and restores exact order on failure", async ({ page }) => {
  await workspace(page); const before = await page.locator(".task-row").evaluateAll(rows => rows.map(row => row.getAttribute("data-task-id")));
  const slow = await slowWrites(page, taskWrite, true);
  await page.getByRole("checkbox", { name: "Complete Review presentation", exact: true }).click();
  await expect(page.locator('.task-row[data-task-id="now"] .task-check')).toHaveText("[✓]", { timeout: 1200 });
  expect(slow.settled()).toBe(0); await expect(page.getByRole("checkbox", { name: "Complete Overdue essay", exact: true })).toBeEnabled();
  await expect(page.locator('.task-row[data-task-id="now"]')).toBeVisible({ timeout: 6000 });
  expect(await page.locator(".task-row").evaluateAll(rows => rows.map(row => row.getAttribute("data-task-id")))).toEqual(before);
  await expect(page.locator(".mutation-toast")).toContainText("Couldn't complete task.");
  await expect(page.locator(".mutation-toast")).not.toContainText("Raw backend");
});

test("3000ms successful completion has no spinner, overlay or refetch flicker", async ({ page }) => {
  const state = await workspace(page); const slow = await slowWrites(page, taskWrite);
  await page.getByRole("checkbox", { name: "Complete Review presentation", exact: true }).click();
  await expect(page.locator('.task-row[data-task-id="now"] .task-check')).toHaveText("[✓]", { timeout: 1200 }); expect(slow.settled()).toBe(0);
  await expect(page.getByRole("dialog")).toHaveCount(0); await expect.poll(() => state.patches.length).toBe(1); await expect(page.locator('.task-row[data-task-id="now"] .task-check')).toHaveText("[✓]");
});

test("3000ms create permits editing a temporary task, assigns one stable row and real request ID", async ({ page }) => {
  const state = await workspace(page); const slow = await slowWrites(page, taskWrite);
  await capture(page, "Fast create #English @Homework today"); await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.locator('.task-row[data-sync-state="creating"]')).toHaveCount(1, { timeout: 1200 });
  const temporary = await page.locator('.task-row[data-sync-state="creating"]').getAttribute("data-task-id"); expect(temporary).toMatch(/^temp:/); expect(slow.settled()).toBe(0);
  await page.getByRole("button", { name: "Done", exact: true }).click(); await page.locator('.task-row[data-sync-state="creating"] .task-content').click(); const dialog = page.locator(".inspector-dialog");
  await dialog.getByLabel("Task title", { exact: true }).fill("Edited while creating"); await dialog.getByLabel("Task title", { exact: true }).blur();
  await expect(page.locator(".task-content").filter({ hasText: "Edited while creating" })).toHaveCount(1, { timeout: 1200 });
  await expect.poll(() => state.patches.length, { timeout: 10000 }).toBe(1); expect(state.patches[0].id).toBe("created-1"); expect(state.creates).toHaveLength(1);
  await expect(page.locator('.task-row[data-task-id="created-1"]')).toHaveCount(1); await expect(page.locator(`.task-row[data-task-id="${temporary}"]`)).toHaveCount(0);
  await expect(dialog.getByLabel("Task title", { exact: true })).toHaveValue("Edited while creating");
});

test("3000ms temp-task deletion stays absent and archives the eventual real task", async ({ page }) => {
  const state = await workspace(page); await slowWrites(page, taskWrite);
  await capture(page, "Delete pending #English @Homework today"); await page.getByRole("button", { name: "Create task", exact: true }).click(); await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.locator('.task-row[data-sync-state="creating"] .task-content').click(); await page.getByRole("button", { name: "Trash task", exact: true }).click(); await page.getByRole("dialog", { name: "Trash this Notion task?" }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator(".task-content").filter({ hasText: "Delete pending" })).toHaveCount(0, { timeout: 1200 });
  await expect.poll(() => state.deletes, { timeout: 10000 }).toEqual(["created-1"]); expect(state.graph.tasks.some(task => task.id === "created-1")).toBe(false);
});

test("3000ms title edit rolls back while retaining the entered correction", async ({ page }) => {
  await workspace(page); const dialog = await openTask(page); const slow = await slowWrites(page, taskWrite, true);
  await dialog.getByLabel("Task title", { exact: true }).fill("Immediate new title"); await dialog.getByLabel("Task title", { exact: true }).blur();
  await expect(page.locator('.task-row[data-task-id="now"] .task-title')).toContainText("Immediate new title", { timeout: 1200 }); expect(slow.settled()).toBe(0);
  await expect(page.locator('.task-row[data-task-id="now"] .task-title')).toContainText("Review presentation", { timeout: 6000 });
  await expect(dialog.getByLabel("Task title", { exact: true })).toHaveValue("Immediate new title"); await expect(page.locator(".mutation-toast")).toContainText("Couldn't update task.");
});

test("3000ms project/area move updates membership before response and rolls back", async ({ page }) => {
  await workspace(page); await navigate(page, "English"); const dialog = await openTask(page); const slow = await slowWrites(page, taskWrite, true);
  await dialog.getByLabel("Task project", { exact: true }).selectOption("shared"); await dialog.getByLabel("Task area", { exact: true }).selectOption("work"); await dialog.getByLabel("Task title", { exact: true }).blur();
  await expect(page.locator('.task-row[data-task-id="now"]')).toHaveCount(0, { timeout: 1200 }); expect(slow.settled()).toBe(0);
  await expect(page.locator('.task-row[data-task-id="now"]')).toHaveCount(1, { timeout: 6000 });
});

test("3000ms confirmed delete closes immediately and restores the task on failure", async ({ page }) => {
  await workspace(page); const dialog = await openTask(page); const slow = await slowWrites(page, taskWrite, true);
  await dialog.getByRole("button", { name: "Trash task", exact: true }).click(); await page.getByRole("dialog", { name: "Trash this Notion task?" }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 1200 }); await expect(page.locator('.task-row[data-task-id="now"]')).toHaveCount(0, { timeout: 1200 }); expect(slow.settled()).toBe(0);
  await expect(page.locator('.task-row[data-task-id="now"]')).toBeVisible({ timeout: 6000 }); await expect(page.locator(".mutation-toast")).toContainText("Couldn't delete task.");
});

test("3000ms highlight and tag changes update rows immediately and roll back independently", async ({ page }) => {
  await workspace(page); const dialog = await openTask(page); const slow = await slowWrites(page, route => taskWrite(route) || localWrite(route), true);
  await dialog.getByRole("checkbox", { name: "Highlight", exact: true }).uncheck();
  await expect(page.locator('.task-row[data-task-id="now"] .highlight')).toHaveCount(0, { timeout: 1200 });
  await dialog.locator(".local-scheduling summary").click(); await dialog.getByLabel("Task tags", { exact: true }).fill("school, immediate-tag");
  await expect(page.locator('.task-row[data-task-id="now"]')).toContainText("immediate-tag", { timeout: 1200 }); expect(slow.settled()).toBe(0);
  await expect(page.locator('.task-row[data-task-id="now"] .highlight')).toHaveCount(1, { timeout: 6000 }); await expect(page.locator('.task-row[data-task-id="now"]')).not.toContainText("immediate-tag", { timeout: 10000 });
});

test("3000ms Contact read and confirmed delete patch unread count and roll back", async ({ page }) => {
  await workspace(page, false, true); await navigate(page, "Contact"); await page.getByRole("button", { name: /Contact Visitor Tomorrow/ }).click(); const detail = page.locator(".contact-detail");
  const slow = await slowWrites(page, route => route.request().method() !== "GET" && /\/api\/contact\//.test(route.request().url()), true);
  await detail.getByRole("button", { name: "Mark read", exact: true }).click(); await expect(detail.getByRole("button", { name: "Mark unread", exact: true })).toBeVisible({ timeout: 1200 }); expect(slow.settled()).toBe(0);
  await expect(detail.getByRole("button", { name: "Mark read", exact: true })).toBeVisible({ timeout: 6000 });
  await detail.getByRole("button", { name: "Delete message", exact: true }).click(); await page.getByRole("dialog", { name: "Delete Contact message?" }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator(".contact-row").filter({ hasText: "Contact Visitor" })).toHaveCount(0, { timeout: 1200 }); await expect(page.locator(".contact-row").filter({ hasText: "Contact Visitor" })).toHaveCount(1, { timeout: 6000 });
});

test("failed note save preserves unsaved text after closing and reopening", async ({ page }) => {
  await workspace(page); let dialog = await openTask(page); await slowWrites(page, localWrite, true);
  await dialog.getByRole("button", { name: "Edit", exact: true }).click(); await dialog.getByLabel("Markdown note", { exact: true }).fill("Important new content"); await dialog.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(dialog.getByLabel("Markdown note", { exact: true })).toHaveValue("Important new content"); await expect(dialog.getByRole("alert").filter({ hasText: "Couldn't save note" })).toBeVisible({ timeout: 6000 });
  await page.keyboard.press("Escape"); dialog = await openTask(page); if (await dialog.getByRole("button", { name: "Edit", exact: true }).count()) await dialog.getByRole("button", { name: "Edit", exact: true }).click(); await expect(dialog.getByLabel("Markdown note", { exact: true })).toHaveValue("Important new content"); await expect(dialog).toContainText("unsaved");
});

test("upload appears before bytes finish, remains failed with Retry and Remove", async ({ page }) => {
  await workspace(page); const dialog = await openTask(page); await slowWrites(page, route => route.request().method() === "POST" && new URL(route.request().url()).pathname === "/api/attachments", true);
  await dialog.getByLabel("Upload attachment", { exact: true }).setInputFiles({ name: "pending.txt", mimeType: "text/plain", buffer: Buffer.from("upload body") });
  const row = dialog.locator(".resource-row").filter({ hasText: "pending.txt" }); await expect(row).toContainText("uploading", { timeout: 1200 }); await expect(row.getByRole("link")).toHaveCount(0);
  await expect(row).toContainText("upload failed", { timeout: 6000 }); await expect(row.getByRole("button", { name: "Retry", exact: true })).toBeVisible(); await row.getByRole("button", { name: "Remove", exact: true }).click(); await expect(row).toHaveCount(0);
});

test("offline completion stays unsynced and explicit retry commits once after reconnect", async ({ page, context }) => {
  const state = await workspace(page); await context.setOffline(true);
  await page.getByRole("checkbox", { name: "Complete Review presentation", exact: true }).click();
  await expect(page.locator('.task-row[data-task-id="now"] .task-check')).toHaveText("[✓]"); await expect(page.locator(".mutation-sync")).toContainText("unsynced"); expect(state.patches).toHaveLength(0);
  await context.setOffline(false); await page.getByRole("button", { name: "Retry pending changes", exact: true }).click(); await expect.poll(() => state.patches.length).toBe(1); await expect(page.locator(".mutation-sync")).toHaveCount(0);
  expect(state.patches[0].body).toEqual({ completed: true });
});

test("3000ms rapid B then C edits stay C throughout reconciliation", async ({ page }) => {
  const state = await workspace(page); const dialog = await openTask(page), slow = await slowWrites(page, taskWrite);
  await dialog.getByLabel("Task title", { exact: true }).fill("B title"); await dialog.getByLabel("Task title", { exact: true }).blur();
  await dialog.getByLabel("Task title", { exact: true }).fill("C title"); await dialog.getByLabel("Task title", { exact: true }).blur();
  await expect(page.locator('.task-row[data-task-id="now"] .task-title')).toContainText("C title", { timeout: 1200 }); expect(slow.requests).toHaveLength(1);
  await expect.poll(() => state.patches.length).toBe(1); await expect(page.locator('.task-row[data-task-id="now"] .task-title')).toContainText("C title"); await expect(dialog.getByLabel("Task title", { exact: true })).toHaveValue("C title");
  await expect.poll(() => state.patches.length, { timeout: 10000 }).toBe(2); await expect(page.locator('.task-row[data-task-id="now"] .task-title')).toContainText("C title");
});

test("failed create removes its temporary row and preserves the guarded input after closing", async ({ page }) => {
  await workspace(page); await slowWrites(page, taskWrite, true);
  await capture(page, "Restore me #English @Homework today"); await page.getByRole("button", { name: "Create task", exact: true }).click(); await expect(page.locator('.task-row[data-sync-state="creating"]')).toHaveCount(1); await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator('.task-row[data-sync-state="creating"]')).toHaveCount(0, { timeout: 6000 }); await expect(page.locator(".mutation-toast")).toContainText("Couldn't create task.");
  await page.keyboard.press("n"); const dialog = page.getByRole("dialog", { name: "Quick add", exact: true }); await expect(dialog.getByLabel("Task input")).toHaveValue("Restore me #English @Homework today"); await expect(dialog).toContainText("Creation unconfirmed"); await expect(dialog.getByRole("button", { name: "Create task", exact: true })).toBeDisabled();
});

test("3000ms saved filter appears immediately, rolls back and retains its form", async ({ page }) => {
  await workspace(page); await navigate(page, "Settings"); const slow = await slowWrites(page, localWrite, true);
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Save filter", exact: true }) }); await form.getByLabel("Name", { exact: true }).fill("Immediate filter"); await form.getByRole("button", { name: "Save filter", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit filter Immediate filter", exact: true })).toBeVisible({ timeout: 1200 }); expect(slow.settled()).toBe(0);
  await expect(page.getByRole("button", { name: "Edit filter Immediate filter", exact: true })).toHaveCount(0, { timeout: 6000 }); await expect(form.getByLabel("Name", { exact: true })).toHaveValue("Immediate filter");
});

test("3000ms confirmed attachment deletion restores the original download on failure", async ({ page }) => {
  await workspace(page); const dialog = await openTask(page); await slowWrites(page, route => route.request().method() === "DELETE" && /\/api\/attachments\//.test(route.request().url()), true);
  await dialog.getByRole("button", { name: "Delete attachment presentation-outline.pdf", exact: true }).click(); await page.getByRole("dialog", { name: "Delete presentation-outline.pdf?", exact: true }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog.getByRole("link", { name: "presentation-outline.pdf", exact: true })).toHaveCount(0, { timeout: 1200 }); await expect(dialog.getByRole("link", { name: "presentation-outline.pdf", exact: true })).toBeVisible({ timeout: 6000 }); await expect(page.locator(".mutation-toast")).toContainText("Couldn't delete file.");
});

for (const delay of [500, 1500]) test(`${delay}ms completion changes the UI before the response`, async ({ page }) => {
  await workspace(page); const slow = await slowWrites(page, taskWrite, false, delay);
  await page.getByRole("checkbox", { name: "Complete Review presentation", exact: true }).click(); await expect(page.locator('.task-row[data-task-id="now"] .task-check')).toHaveText("[✓]", { timeout: 400 }); expect(slow.settled()).toBe(0); await expect(page.locator(".mutation-sync")).toHaveCount(0);
});

test("failed upload retries the retained bytes and exposes a download only after success", async ({ page }) => {
  await workspace(page); const dialog = await openTask(page); let attempts = 0;
  await page.route("**/api/attachments", async route => {
    if (route.request().method() !== "POST") return route.fallback(); attempts++;
    await new Promise(resolve => setTimeout(resolve, 1500));
    if (attempts === 1) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "TEST_FAILURE", message: "upload failed", correlationId: "fixture" } }) });
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "uploaded-ready", entityType: "task", entityId: "now", name: "retry.txt", mimeType: "text/plain", size: 5, createdAt: "2026-10-03T12:00:00Z" }) });
  });
  await dialog.getByLabel("Upload attachment", { exact: true }).setInputFiles({ name: "retry.txt", mimeType: "text/plain", buffer: Buffer.from("bytes") }); const row = dialog.locator(".resource-row").filter({ hasText: "retry.txt" });
  await expect(row).toContainText("upload failed"); await row.getByRole("button", { name: "Retry", exact: true }).click(); await expect(row).toContainText("uploading"); await expect(row.getByRole("link")).toHaveCount(0);
  await expect(row.getByRole("link", { name: "retry.txt", exact: true })).toHaveAttribute("href", "/api/attachments/uploaded-ready"); expect(attempts).toBe(2); await expect(row).not.toContainText("uploading");
});
