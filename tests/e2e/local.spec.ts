import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { LocalSnapshot } from "../../src/lib/types";

test.use({ serviceWorkers: "block" });
const runtimeErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  runtimeErrors.length = 0;
  page.on("pageerror", error => runtimeErrors.push(error.message));
  page.on("console", message => { if (/maximum update depth|too many re-renders/i.test(message.text())) runtimeErrors.push(message.text()); });
});
const instant = "2026-10-03T12:00:00Z";
const checksum = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
async function write(request: APIRequestContext, body: unknown) {
  const origin = new URL(process.env.E2E_BASE_URL || "http://127.0.0.1:3000").origin;
  const response = await request.post("/api/local", { headers: { origin }, data: body }); expect(response.ok()).toBe(true); return response.json();
}
async function fixtures(page: Page) {
  await page.clock.install({ time: new Date(instant) });
  const state = { unavailable: false, contactReads: 0, githubReads: 0 };
  await page.route("**/api/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/graph") return json({ graph: { syncedAt: instant, areas: [{ id: "local-test-area", name: "Local Test Area", type: null, projectIds: ["local-test-project"], url: null }], projects: [{ id: "local-test-project", name: "Local Test Project", areaIds: ["local-test-area"], status: null, priority: null, dates: { start: null, end: null }, url: null }], tasks: [] }, diagnostics: [{ source: "notion", status: state.unavailable ? "error" : "ok", message: state.unavailable ? "Test Notion read unavailable; local context remains." : "Test graph" }], completionEnabled: false });
    if (pathname === "/api/github") { state.githubReads++; return json({ configured: false, username: null, repositories: { items: [], status: "disabled", message: "Test disabled", syncedAt: null, hasMore: false, page: 1 }, issues: { items: [], status: "disabled", message: "Test disabled", syncedAt: null, hasMore: false, page: 1 }, reviews: { items: [], status: "disabled", message: "Test disabled", syncedAt: null, hasMore: false, page: 1 }, diagnostics: [] }); }
    if (pathname === "/api/contact") { state.contactReads++; return json({ items: [], total: 0, unreadTotal: 0, page: 1, hasMore: false, status: "disabled", message: "Test disabled", syncedAt: null, diagnostics: [] }); }
    if (pathname === "/api/config") return json({ timezone: "Europe/Berlin", maxUploadBytes: 20 * 1024 * 1024, appName: "TÆSKS" });
    if (pathname === "/api/notion/schema") return json({ configured: false, apiVersion: "2026-03-11", diagnostics: [], properties: { tasks: [], projects: [], areas: [] }, completionCandidates: [], completion: null });
    return route.continue(); // Local SQLite and physical attachments remain REAL.
  });
  return state;
}
async function command(page: Page, search: string) {
  await expect(page.locator("h1")).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: "Search", exact: true }).fill(search); await page.locator(".palette-result").first().click();
}
const owned = new Set<string>();
test.afterEach(async ({ request }) => {
  const snapshot: LocalSnapshot = await (await request.get("/api/local")).json();
  const origin = new URL(process.env.E2E_BASE_URL || "http://127.0.0.1:3000").origin;
  for (const file of snapshot.attachments.filter(file => owned.has(file.entityId))) expect((await request.delete(`/api/attachments/${file.id}`, { headers: { origin }, data: { confirmed: true } })).ok()).toBe(true);
  for (const note of snapshot.notes.filter(note => owned.has(note.entityId))) await write(request, { action: "deleteNote", entityType: note.entityType, entityId: note.entityId });
  for (const link of snapshot.links.filter(link => owned.has(link.entityId))) await write(request, { action: "deleteLink", id: link.id });
  for (const alias of snapshot.aliases.filter(alias => owned.has(alias.alias))) await write(request, { action: "deleteAlias", id: alias.id });
  for (const filter of snapshot.filters.filter(filter => owned.has(filter.name))) await write(request, { action: "deleteFilter", id: filter.id });
  owned.clear();
  expect(runtimeErrors).toEqual([]);
});

test("idle source observers remain bounded and workspace stays responsive", async ({ page }) => {
  const state = await fixtures(page); await page.goto("/"); await expect(page.locator("h1")).toBeVisible();
  // The shell intentionally reads all messages and the unread Inbox page once.
  await expect.poll(() => state.contactReads).toBe(2); await expect.poll(() => state.githubReads).toBe(1);
  await page.clock.runFor(2000);
  expect(state.contactReads).toBe(2); expect(state.githubReads).toBe(1);
  await command(page, "Settings & diagnostics"); await expect(page.locator("h1")).toContainText("Settings");
  await page.clock.runFor(2000); expect(state.contactReads).toBeLessThanOrEqual(3); expect(state.githubReads).toBe(1);
});

test("real Markdown, safe links, downloads and deliberate deletion survive reload and Notion failure", async ({ page, request }) => {
  const id = `local-e2e-${randomUUID()}`; owned.add(id);
  await write(request, { action: "saveNote", entityType: "project", entityId: id, content: `# ${id}\nOriginal local context` });
  const state = await fixtures(page); await page.goto("/"); await command(page, id);
  let panel = page.getByRole("dialog", { name: "Local context", exact: true }); await expect(panel).toContainText("Original local context");
  await panel.getByRole("button", { name: "Edit", exact: true }).click();
  const content = `# ${id}\n## Architecture\n\n\`\`\`ts\nconst safe = true;\n\`\`\`\n- First\n- Second\n\nInline \`code\` and **bold**.\n[Docs](https://example.com/docs)\n[Unsafe](javascript:alert%281%29)\n[Credentials](https://user:secret@example.com)\n<script>window.localTestUnsafe = true</script>\n&lt;escaped&gt;`;
  await panel.getByRole("textbox", { name: "Markdown note" }).fill(content);
  let failNext = true;
  await page.route("**/api/local", async route => {
    if (route.request().method() === "POST" && route.request().postDataJSON().action === "saveNote" && failNext) { failNext = false; return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "TEST_FAILED_SAVE", message: "Test save failed; keep content.", correlationId: "local-test" } }) }); }
    return route.fallback();
  });
  await panel.getByRole("button", { name: "Save note", exact: true }).click(); await expect(panel.getByRole("alert")).toContainText("Couldn't save note. Unsaved."); await expect(panel.getByRole("textbox", { name: "Markdown note" })).toHaveValue(content);
  await panel.getByRole("button", { name: "Save note", exact: true }).click(); await expect(panel.getByRole("heading", { name: "Architecture", exact: true })).toBeVisible();
  await expect(panel.locator("pre code")).toContainText("const safe = true"); await expect(panel.locator(".markdown li")).toHaveCount(2); await expect(panel.getByRole("link", { name: "Docs", exact: true })).toHaveAttribute("href", "https://example.com/docs"); await expect(panel.getByRole("link", { name: "Unsafe", exact: true })).toHaveCount(0); await expect(panel.getByRole("link", { name: "Credentials", exact: true })).toHaveCount(0); await expect(panel.locator(".markdown script")).toHaveCount(0); await expect(panel.locator(".markdown")).toContainText("<escaped>");
  await panel.getByRole("button", { name: "+ link", exact: true }).click(); await panel.getByLabel("Label", { exact: true }).fill("Local docs"); await panel.getByLabel("URL", { exact: true }).fill("https://example.com/local"); await panel.getByRole("button", { name: "Add link", exact: true }).click(); await expect(panel.getByRole("link", { name: "Local docs", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Edit link Local docs", exact: true }).click(); await panel.getByLabel("Label", { exact: true }).fill("Edited local docs"); await panel.getByLabel("URL", { exact: true }).fill("https://example.com/edited"); await panel.getByRole("button", { name: "Save link", exact: true }).click(); await expect(panel.getByRole("link", { name: "Edited local docs", exact: true })).toHaveAttribute("href", "https://example.com/edited");
  const file = Buffer.from(`Attachment ✓ ${id}\n`, "utf8"); const filename = `${id}.txt`;
  await panel.getByLabel("Upload attachment", { exact: true }).setInputFiles({ name: filename, mimeType: "text/plain", buffer: file }); await expect(panel.getByRole("link", { name: filename, exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download"); await panel.getByRole("link", { name: filename, exact: true }).click(); const download = await downloadPromise; expect(checksum(await readFile((await download.path())!))).toBe(checksum(file));
  state.unavailable = true; await page.reload(); await command(page, id); panel = page.getByRole("dialog", { name: "Local context", exact: true }); await expect(panel.getByRole("heading", { name: "Architecture", exact: true })).toBeVisible(); await expect(panel.getByRole("link", { name: filename, exact: true })).toBeVisible();
  await panel.getByRole("button", { name: `Delete attachment ${filename}`, exact: true }).click(); let confirm = page.getByRole("dialog", { name: `Delete ${filename}?`, exact: true }); await confirm.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(panel.getByRole("link", { name: filename, exact: true })).toBeVisible();
  await panel.getByRole("button", { name: `Delete attachment ${filename}`, exact: true }).click(); confirm = page.getByRole("dialog", { name: `Delete ${filename}?`, exact: true }); await confirm.getByRole("button", { name: "Delete", exact: true }).click(); await expect(panel.getByRole("link", { name: filename, exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Delete link Edited local docs", exact: true }).click(); await page.getByRole("dialog", { name: "Delete this link?", exact: true }).getByRole("button", { name: "Delete", exact: true }).click(); await expect(panel.getByRole("link", { name: "Local docs", exact: true })).toHaveCount(0);
  await page.reload(); await command(page, id); panel = page.getByRole("dialog", { name: "Local context", exact: true }); await expect(panel.getByRole("heading", { name: "Architecture", exact: true })).toBeVisible(); await expect(panel.locator(".resource-row")).toHaveCount(0);
  const snapshot: LocalSnapshot = await (await request.get("/api/local")).json(); expect(snapshot.notes.find(note => note.entityId === id)?.content).toBe(content); expect(snapshot.attachments.some(file => file.entityId === id)).toBe(false);
});

test("real settings persist aliases and saved filter criteria", async ({ page, request }) => {
  const name = `local-e2e-${randomUUID()}`; owned.add(name);
  await fixtures(page); await page.goto("/"); await command(page, "Settings & diagnostics");
  await page.getByRole("combobox", { name: "Project or area", exact: true }).selectOption("project:local-test-project"); await page.getByLabel("Alias", { exact: true }).fill(name); await page.getByRole("button", { name: "Add alias", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: "Alias saved" })).toBeVisible();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Save filter", exact: true }) }); await form.getByLabel("Name", { exact: true }).fill(name); await form.getByRole("combobox", { name: "Project", exact: true }).selectOption("local-test-project"); await form.getByRole("combobox", { name: "Priority", exact: true }).selectOption("high"); await form.getByRole("combobox", { name: "completed", exact: true }).selectOption("false"); await form.getByRole("button", { name: "Save filter", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: "Filter saved" })).toBeVisible();
  await page.reload(); await expect(page.getByRole("button", { name: `Edit alias ${name}`, exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: `Edit filter ${name}`, exact: true })).toBeVisible();
  const snapshot: LocalSnapshot = await (await request.get("/api/local")).json(); expect(snapshot.aliases.find(alias => alias.alias === name)).toMatchObject({ entityType: "project", entityId: "local-test-project" }); expect(snapshot.filters.find(filter => filter.name === name)?.criteria).toEqual({ projectId: "local-test-project", priority: "high", completed: false });
});
