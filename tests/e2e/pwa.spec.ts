import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { LocalSnapshot } from "../../src/lib/types";
test.use({ serviceWorkers: "allow" });
test.describe.configure({ mode: "serial" });
const owned = new Set<string>();
async function command(page: Page, title: string) { await page.keyboard.press("Control+k"); const dialog = page.getByRole("dialog", { name: "Find your next move" }); await dialog.getByRole("textbox").fill(title); await dialog.getByRole("button").filter({ hasText: title }).first().click(); }
async function warm(page: Page) {
  await page.goto("/"); await expect(page.locator("h1")).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); await expect(page.locator(".app-shell")).toBeVisible();
  await page.waitForFunction(async () => { const cache = await caches.open("taesks-reads-v1"); return !!await cache.match(`${location.origin}/api/local`) && !!await cache.match(`${location.origin}/api/graph`); });
}
test.afterEach(async ({ request }) => {
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  const snapshot: LocalSnapshot = await (await request.get("/api/local")).json();
  for (const draft of snapshot.drafts) if (owned.has(draft.title)) await request.post("/api/local", { headers: { Origin: origin }, data: { action: "deleteDraft", id: draft.id } });
  for (const id of owned) if (id.startsWith("reminder-")) await request.post("/api/local", { headers: { Origin: origin }, data: { action: "setTaskMetadata", taskId: id, patch: { reminderAt: null, reminderDismissedAt: null } } });
});
test("real service worker reloads shell and reads offline, keeps one durable draft and syncs only after ACK", async ({ page, context, request }) => {
  const title = `PWA queued ${randomUUID()}`; owned.add(title); let taskWrites = 0;
  page.on("request", request => { if (request.url().includes("/api/tasks") && request.method() !== "GET") taskWrites++; });
  await warm(page);
  const manifest = await (await request.get("/manifest.webmanifest")).json(); expect(manifest.name).toBe("TÆSKS"); expect(manifest.display).toBe("standalone"); expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === "maskable")).toBe(true);
  await context.setOffline(true); await page.reload(); await expect(page.locator(".app-shell")).toBeVisible(); await expect(page.locator(".offline-banner")).toContainText("Offline");
  await page.locator(".header-add").click(); const capture = page.getByRole("dialog", { name: "Quick add", exact: true }); await capture.getByLabel("Task input").fill(title); await expect(capture.getByRole("button", { name: "Create task", exact: true })).toBeDisabled(); await capture.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator(".draft-row").filter({ hasText: title })).toContainText("waiting to sync");
  const id = await page.evaluate(() => Object.keys(localStorage).find(key => key.startsWith("taesks.device-draft."))!); expect(id).toBeTruthy();
  await page.reload(); await command(page, "Inbox"); await expect(page.locator(".draft-row").filter({ hasText: title })).toHaveCount(1);
  await expect(page.evaluate(async () => { try { await fetch("/api/health"); return true; } catch { return false; } })).resolves.toBe(false);
  await context.setOffline(false); await expect.poll(async () => { const data: LocalSnapshot = await (await request.get("/api/local")).json(); return data.drafts.filter(draft => draft.title === title).length; }).toBe(1);
  await expect(page.locator(".draft-row").filter({ hasText: title })).toContainText("draft"); expect(await page.evaluate(key => localStorage.getItem(key), id)).toBeNull(); expect(taskWrites).toBe(0);
});
test("lost ACK retains the same draft ID across reload and duplicate-safe retry", async ({ page, context, request }) => {
  const title = `PWA ACK ${randomUUID()}`; owned.add(title); await warm(page);
  let savedId = ""; let once = true;
  await page.route("**/api/local", async route => { const body = route.request().method() === "POST" ? route.request().postDataJSON() : null; if (once && body?.action === "saveDraft") { once = false; savedId = body.draft.id; await route.fetch(); await route.abort("failed"); } else await route.continue(); });
  await page.locator(".header-add").click(); const capture = page.getByRole("dialog", { name: "Quick add", exact: true }); await capture.getByLabel("Task input").fill(title); await capture.getByRole("button", { name: "Save draft", exact: true }).click(); await expect(page.locator(".draft-row").filter({ hasText: title })).toContainText("waiting to sync"); expect(savedId).toBeTruthy();
  await context.setOffline(true); await page.reload(); await command(page, "Inbox"); await expect(page.locator(".draft-row").filter({ hasText: title })).toHaveCount(1);
  await context.setOffline(false); await expect.poll(async () => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("taesks.device-draft.")).length)).toBe(0);
  const snapshot: LocalSnapshot = await (await request.get("/api/local")).json(); expect(snapshot.drafts.filter(draft => draft.title === title).map(draft => draft.id)).toEqual([savedId]);
});
test("queued draft can be edited and deleted offline before syncing", async ({ page, context, request }) => {
  const title = `PWA delete ${randomUUID()}`; owned.add(title); await warm(page); await context.setOffline(true);
  await page.locator(".header-add").click(); let dialog = page.getByRole("dialog", { name: "Quick add", exact: true }); await dialog.getByLabel("Task input").fill(title); await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
  let row = page.locator(".draft-row").filter({ hasText: title }); await row.getByRole("button", { name: "Resolve", exact: true }).click(); dialog = page.getByRole("dialog", { name: "Resolve Inbox draft", exact: true }); await dialog.getByLabel("Task input").fill(`${title} edited`); await dialog.getByRole("button", { name: "Update draft", exact: true }).click(); row = page.locator(".draft-row").filter({ hasText: title }); await expect(row).toContainText("edited");
  await row.getByRole("button", { name: "Delete", exact: true }).click(); await page.getByRole("dialog", { name: "Delete this draft?", exact: true }).getByRole("button", { name: "Delete", exact: true }).click(); await expect(row).toHaveCount(0); await page.reload(); await command(page, "Inbox"); await expect(row).toHaveCount(0);
  await context.setOffline(false); await expect.poll(async () => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("taesks.device-draft.")).length)).toBe(0);
  const data: LocalSnapshot = await (await request.get("/api/local")).json(); expect(data.drafts.some(draft => draft.title.startsWith(title))).toBe(false);
});
test("due reminders open local context, retain failed dismissal, and acknowledge snooze/dismiss", async ({ page, request }) => {
  const id = `reminder-${randomUUID()}`; owned.add(id); const origin = new URL(test.info().project.use.baseURL as string).origin;
  await request.post("/api/local", { headers: { Origin: origin }, data: { action: "setTaskMetadata", taskId: id, patch: { reminderAt: new Date(Date.now() - 60_000).toISOString(), reminderDismissedAt: null } } });
  await warm(page); const reminders = page.getByRole("region", { name: "Due reminders" }); const row = reminders.locator(".reminder-row").filter({ hasText: id }); await expect(row).toBeVisible(); await row.getByRole("button", { name: `Local context / ${id}`, exact: true }).click(); await expect(page.getByRole("dialog", { name: "Local context", exact: true })).toBeVisible(); await page.keyboard.press("Escape");
  let fail = true; await page.route("**/api/local", async route => { if (fail && route.request().method() === "POST" && route.request().postDataJSON().action === "setTaskMetadata") { fail = false; await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "TEST_FAILURE", message: "Fixture dismissal failed", correlationId: "fixture" } }) }); } else await route.continue(); });
  await row.getByRole("button", { name: "Dismiss", exact: true }).click(); await expect(page.locator(".mutation-toast")).toContainText("Couldn't update task."); await expect(row).toBeVisible();
  const before = Date.now(); await row.getByRole("button", { name: "Snooze 10 min", exact: true }).click(); await expect(row).toHaveCount(0); await expect(page.locator(".mutation-sync")).toHaveCount(0); let snapshot: LocalSnapshot = await (await request.get("/api/local")).json(); expect(Date.parse(snapshot.metadata.find(item => item.taskId === id)!.reminderAt!)).toBeGreaterThanOrEqual(before + 599_000);
  await request.post("/api/local", { headers: { Origin: origin }, data: { action: "setTaskMetadata", taskId: id, patch: { reminderAt: new Date(Date.now() - 60_000).toISOString(), reminderDismissedAt: null } } }); await page.reload(); await expect(row).toBeVisible(); await row.getByRole("button", { name: "Dismiss", exact: true }).click(); await expect(row).toHaveCount(0); await expect(page.locator(".mutation-sync")).toHaveCount(0); snapshot = await (await request.get("/api/local")).json(); expect(snapshot.metadata.find(item => item.taskId === id)!.reminderDismissedAt).toBeTruthy();
});
test("two open windows serialize a queued save and notifications require an explicit permission action", async ({ page, context, request }) => {
  const title = `PWA tabs ${randomUUID()}`; owned.add(title);
  await context.addInitScript(() => {
    const fixture = { permission: "default", requests: 0 }; Object.assign(window, { notificationFixture: fixture });
    Object.defineProperty(window, "Notification", { configurable: true, value: { get permission() { return fixture.permission; }, requestPermission: async () => { fixture.requests++; fixture.permission = "denied"; return "denied"; } } });
  });
  await warm(page); await command(page, "Settings");
  await expect(page.getByRole("button", { name: "Enable browser notifications", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { notificationFixture: { requests: number } }).notificationFixture.requests)).toBe(0);
  await page.getByRole("button", { name: "Enable browser notifications", exact: true }).click();
  await expect(page.locator(".setting-line").filter({ hasText: "Browser notifications" })).toContainText("denied");
  expect(await page.evaluate(() => (window as unknown as { notificationFixture: { requests: number } }).notificationFixture.requests)).toBe(1);
  const second = await context.newPage(); await second.goto("/"); await expect(second.locator(".app-shell")).toBeVisible();
  let saves = 0; context.on("request", call => { if (call.url().endsWith("/api/local") && call.method() === "POST" && call.postDataJSON()?.action === "saveDraft") saves++; });
  await context.setOffline(true); await page.locator(".header-add").click();
  const capture = page.getByRole("dialog", { name: "Quick add", exact: true }); await capture.getByLabel("Task input").fill(title); await capture.getByRole("button", { name: "Save draft", exact: true }).click();
  await command(second, "Inbox"); await expect(second.locator(".draft-row").filter({ hasText: title })).toContainText("waiting to sync");
  await context.setOffline(false); await expect.poll(async () => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("taesks.device-draft.")).length)).toBe(0);
  const snapshot: LocalSnapshot = await (await request.get("/api/local")).json(); expect(snapshot.drafts.filter(draft => draft.title === title)).toHaveLength(1); expect(saves).toBe(1);
  await second.close();
});
