import { expect, test } from "@playwright/test";
import { workspace, navigate, capture, instant, today, makeTask } from "./workspace.fixture";

test("two already-open capture editors send one create after a successful ACK", async ({ page, context }) => {
  const first = await workspace(page); const second = await context.newPage(); const other = await workspace(second);
  const input = "Cross-window capture #English @Homework tomorrow";
  await capture(page, input); await capture(second, input);
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.locator(".creation-result").getByRole("status")).toContainText("Created in Notion");
  await expect(second.getByRole("textbox", { name: "Task input" })).toBeDisabled();
  await expect(second.getByRole("alert")).toContainText("Task created in another window");
  await second.locator(".capture-dialog form").evaluate(element => (element as HTMLFormElement).requestSubmit());
  expect(first.creates).toHaveLength(1); expect(other.creates).toHaveLength(0);
  await second.close();
});

test("capture storage failure sends no task, retains input and allows correction after storage recovers", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Object.defineProperty(window, "captureStorageBlocked", { value: true, writable: true });
    Storage.prototype.setItem = function (key, value) { if (key === "taesks.capture-outcome" && (window as unknown as { captureStorageBlocked: boolean }).captureStorageBlocked) throw new DOMException("Storage unavailable", "QuotaExceededError"); return original.call(this, key, value); };
  });
  const state = await workspace(page); const input = "Retained storage input #English @Homework tomorrow";
  await capture(page, input); await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("no task was sent");
  await expect(page.getByRole("textbox", { name: "Task input" })).toHaveValue(input);
  await expect(page.getByRole("textbox", { name: "Task input" })).toBeEnabled(); expect(state.creates).toHaveLength(0);
  await page.evaluate(() => { (window as unknown as { captureStorageBlocked: boolean }).captureStorageBlocked = false; });
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.locator(".creation-result").getByRole("status")).toContainText("Created in Notion"); expect(state.creates).toHaveLength(1);
});

test("uncertain source conversion can verify and link an inspected task without another create", async ({ page }) => {
  const state = await workspace(page, true); state.createError = { status: 409, code: "CONVERSION_UNCERTAIN", message: "Inspect the previous conversion" };
  let links = 0;
  await page.route("**/api/tasks/reconcile", async route => {
    const body = route.request().postDataJSON(); expect(body.inspected).toBe(true); expect(body.source).toMatchObject({ source: "github", externalId: "owner/repo:pull:7" }); expect(body.taskId).toBe("inspected-task");
    state.local.externalLinks.push({ id: "recovered-link", ...body.source, taskId: body.taskId, createdAt: instant }); links++;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ task: makeTask(body.taskId, "Inspected task"), existing: true, warnings: [], snapshot: state.local }) });
  });
  await navigate(page, "Tomorrow #7 parser review"); await page.getByRole("button", { name: "Create task", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create linked task" }); await dialog.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(dialog.getByRole("alert").first()).toContainText("Inspect");
  await dialog.locator("summary").filter({ hasText: "Link existing task" }).click();
  await dialog.getByRole("textbox", { name: "Existing Notion task ID" }).fill("inspected-task");
  const link = dialog.getByRole("button", { name: "Verify and link" }); await expect(link).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /I checked this task/ }).check(); await link.click();
  await expect(dialog.getByRole("status")).toContainText("Already linked / Inspected task"); expect(links).toBe(1); expect(state.creates).toHaveLength(1);
});

test("GitHub palette retains a prior repository context after navigating away", async ({ page }) => {
  const state = await workspace(page, true); await navigate(page, "English");
  await expect(page.getByRole("button", { name: /Mobile repository issue/ })).toBeVisible();
  await navigate(page, "Today"); await page.keyboard.press("Control+k"); await page.getByRole("textbox", { name: "Search", exact: true }).fill("Mobile repository issue");
  await expect(page.locator(".palette-result")).toHaveCount(1); await page.locator(".palette-result").click();
  await expect(page.getByRole("dialog", { name: "Mobile repository issue" })).toBeVisible(); expect(state.creates).toHaveLength(0);
});

test("natural capture previews compactly, prevents duplicate submit and keeps confirmed warnings", async ({ page }) => {
  const state = await workspace(page); state.warnings = ["Created task; recover local details, do not create it again."];
  await capture(page, "Make presentation #English @Homework tomorrow [school] !! every 2 weeks");
  const dialog = page.getByRole("dialog", { name: "Quick add" });
  await expect(dialog.locator(".preview-title")).toHaveText("Make presentation");
  await expect(dialog.locator(".capture-fields")).not.toHaveAttribute("open");
  await expect(dialog.locator(".capture-preview")).toContainText("English"); await expect(dialog.locator(".capture-preview")).toContainText("04.10.");
  if ((page.viewportSize()?.width ?? 1024) <= 760) {
    await expect(dialog.getByLabel("Task input")).toHaveCSS("font-size", "16px");
    const sizes = await page.locator(".task-meta, .task-dates, .task-context, .capture-preview .tag").evaluateAll(nodes => nodes.filter(node => (node as HTMLElement).offsetParent !== null).map(node => parseFloat(getComputedStyle(node).fontSize)));
    expect(sizes.length).toBeGreaterThan(0); expect(sizes.every(size => size >= 10)).toBe(true);
  }
  await page.getByRole("textbox", { name: "Task input" }).press("Enter"); await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status")).toContainText("Created in Notion"); await expect(dialog.getByRole("alert").filter({ hasText: "do not create it again" })).toBeVisible();
  expect(state.creates).toHaveLength(1); expect(state.creates[0]).toMatchObject({ task: { title: "Make presentation", areaId: "homework", projectId: "english", dates: { start: today, end: "2026-10-04" } }, metadata: { priority: "high", recurrenceRule: { frequency: "week", interval: 2 } }, tags: ["school"] });
  await dialog.getByRole("button", { name: "Done" }).click(); await expect(page.locator('.task-content[data-task-id="created-1"]')).toContainText("Make presentation");
});

test("unresolved captures remain local drafts and can be explicitly assigned and converted", async ({ page }) => {
  const state = await workspace(page);
  await capture(page, "Read chapter tomorrow"); const dialog = page.getByRole("dialog", { name: "Quick add" });
  await expect(dialog.getByRole("button", { name: "Create task", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "Task input" }).press("Enter"); expect(state.creates).toHaveLength(0);
  await dialog.getByRole("button", { name: "Save draft", exact: true }).click(); await expect(page.locator("h1")).toHaveText(/Inbox/);
  expect(state.local.drafts).toHaveLength(1); const savedDraftId = state.local.drafts[0].id;
  expect(savedDraftId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await page.getByLabel("Task project", { exact: true }).selectOption("english"); await expect(page.getByLabel("Task area", { exact: true })).toHaveValue("homework");
  await page.getByLabel("Task tags", { exact: true }).fill("one, two"); await expect(page.getByLabel("Task tags", { exact: true })).toHaveValue("one, two");
  await page.getByRole("button", { name: "Create task", exact: true }).click(); await expect(page.getByRole("status").filter({ hasText: "Created in Notion" })).toBeVisible();
  expect(state.creates[0].draftId).toBe(savedDraftId); expect(state.creates[0].tags).toEqual(["one", "two"]); expect(state.local.drafts).toHaveLength(0);
});

test("manual resolution preserves explicit conflicts until fields are confirmed", async ({ page }) => {
  const state = await workspace(page); await capture(page, "Prepare #English @Work tomorrow");
  await expect(page.getByRole("button", { name: "Create task", exact: true })).toBeDisabled();
  await page.getByLabel("Task area", { exact: true }).selectOption("homework"); await page.getByLabel("Task title", { exact: true }).fill("Prepare corrected title");
  await expect(page.getByRole("button", { name: "Create task", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Use edited fields" }).click(); await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Created in Notion" })).toBeVisible(); expect(state.creates[0].task).toMatchObject({ title: "Prepare corrected title", areaId: "homework" });
});

test("inspector edits only changed Notion fields, local tags and completion, and confirms trash", async ({ page }) => {
  const state = await workspace(page); await page.locator('.task-content[data-task-id="now"]').click();
  await page.getByLabel("Task title", { exact: true }).fill("Edited presentation"); await page.getByLabel("Task deadline", { exact: true }).fill("2026-10-12");
  await page.getByLabel("Task deadline", { exact: true }).blur(); await expect.poll(() => state.patches.length).toBe(1); await expect(page.locator(".task-title").filter({ hasText: "Edited presentation" })).toBeVisible();
  expect(state.patches[0].body).toEqual({ task: { title: "Edited presentation", dates: { start: today, end: "2026-10-12" } } });
  await page.locator(".local-scheduling summary").click(); await page.getByLabel("Task tags", { exact: true }).fill("school, focus"); await page.getByLabel("Repeat frequency").selectOption("week"); await page.getByLabel("Repeat interval").fill("2");
  await page.getByLabel("Repeat interval").blur(); await expect.poll(() => state.local.metadata.find(item => item.taskId === "now")?.recurrenceRule).toEqual({ frequency: "week", interval: 2 });
  expect(state.local.metadata.find(item => item.taskId === "now")?.recurrenceRule).toEqual({ frequency: "week", interval: 2 }); expect(state.local.tags.some(tag => tag.name === "focus")).toBe(true);
  await page.getByRole("button", { name: "✓ complete", exact: true }).click(); await expect(page.getByRole("button", { name: "↺ reopen" })).toBeVisible(); await page.getByRole("button", { name: "↺ reopen" }).click();
  await page.getByRole("button", { name: "Trash task" }).click(); expect(state.deletes).toHaveLength(0); const confirm = page.getByRole("dialog", { name: "Trash this Notion task?" }); await confirm.getByRole("button", { name: "Cancel" }).click(); expect(state.deletes).toHaveLength(0);
  await page.getByRole("button", { name: "Trash task" }).click(); await page.getByRole("dialog", { name: "Trash this Notion task?" }).getByRole("button", { name: "Delete", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); await expect.poll(() => state.deletes).toEqual(["now"]);
});

test("overview, upcoming and entity groups retain completed and Someday without active count drift", async ({ page }) => {
  await workspace(page); await navigate(page, "Overview");
  const highlight = page.locator("section.task-section").filter({ has: page.getByRole("heading", { name: /daily highlight/ }) }); await expect(highlight).toContainText("Review presentation"); await expect(highlight).not.toContainText("Future highlight");
  await navigate(page, "Upcoming"); await expect(page.getByRole("heading", { name: /october 2026/ })).toBeVisible();
  await navigate(page, "English"); await expect(page.locator("h1")).toHaveText(/English3/); await expect(page.locator("main")).toContainText("deadline 2026-12-01");
  const done = page.locator("section.task-section").filter({ has: page.getByRole("heading", { name: /completed/ }) }); await expect(done.locator(".task-content")).toBeVisible();
  const someday = page.locator("details.collapsed-section").filter({ hasText: "Someday idea" }); await someday.locator("summary").click(); await expect(someday.locator(".task-content")).toBeVisible();
});

test("global search finds note text, attachment metadata, tags and orphaned local context", async ({ page }) => {
  await workspace(page); await navigate(page, "unique search phrase"); await expect(page.getByRole("dialog", { name: "Review presentation" })).toBeVisible(); await page.keyboard.press("Escape");
  await navigate(page, "presentation-outline.pdf"); await expect(page.getByRole("dialog", { name: "Review presentation" })).toContainText("presentation-outline.pdf"); await page.keyboard.press("Escape");
  await navigate(page, "Offline research"); await expect(page.getByRole("dialog", { name: "Local context" })).toContainText("Stored independently of Notion"); await page.keyboard.press("Escape");
  await navigate(page, "[school]"); await expect(page.locator("h1")).toHaveText(/\[school\]/);
});

test("focused task shortcuts work across sections and leave typing untouched", async ({ page }) => {
  const state = await workspace(page); const first = page.locator('.task-content[data-task-id="overdue"]'); await first.focus(); await page.keyboard.press("j"); await expect(page.locator('.task-content[data-task-id="now"]')).toBeFocused();
  await page.keyboard.press("e"); await expect(page.getByRole("dialog", { name: "Review presentation" })).toBeVisible(); await page.getByLabel("Task title", { exact: true }).fill("nrxe"); await expect(page.getByLabel("Task title", { exact: true })).toHaveValue("nrxe"); expect(state.patches).toHaveLength(0); await page.getByLabel("Task title", { exact: true }).fill("Review presentation"); await page.keyboard.press("Escape");
  await first.focus(); await page.keyboard.press("x"); await expect.poll(() => state.patches.length).toBe(1); expect(state.patches[0]).toMatchObject({ id: "overdue", body: { completed: true } });
});

test("definite preflight failure permits correction but uncertain create locks replay", async ({ page }) => {
  const state = await workspace(page); state.createError = { status: 503, code: "NOTION_DISABLED", message: "Configure Notion" }; await capture(page, "Read #English @Homework tomorrow");
  await page.getByRole("button", { name: "Create task", exact: true }).click(); await expect(page.locator(".mutation-toast")).toContainText("Couldn't create task."); await expect(page.getByRole("button", { name: "Create task", exact: true })).toBeEnabled(); await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeEnabled();
  state.createError = { status: 502, code: "NOTION_WRITE_OUTCOME", message: "Created but unreadable", details: { operation: "task.create", taskId: "known-created" } };
  await page.getByRole("button", { name: "Create task", exact: true }).click(); await expect(page.getByText("Confirmed Task ID: known-created")).toBeVisible(); await expect(page.getByRole("button", { name: "Create task", exact: true })).toBeDisabled(); expect(state.creates).toHaveLength(2);
});



test("inspector refreshes untouched fields after completion without writing them back", async ({ page }) => {
  const state = await workspace(page); await page.locator('.task-content[data-task-id="now"]').click();
  state.graph.tasks.find(task => task.id === "now")!.title = "Changed upstream title";
  await page.getByRole("button", { name: "✓ complete", exact: true }).click(); await expect(page.getByLabel("Task title", { exact: true })).toHaveValue("Changed upstream title");
  await page.getByLabel("Task deadline", { exact: true }).fill("2026-10-12"); await page.getByLabel("Task deadline", { exact: true }).blur();
  await expect.poll(() => state.patches.length).toBe(2); expect(state.patches[1].body).toEqual({ task: { dates: { start: today, end: "2026-10-12" } } });
});

test("uncertain ordinary capture keeps a replay guard across reopening", async ({ page }) => {
  const state = await workspace(page); state.createError = { status: 502, code: "NOTION_UNAVAILABLE", message: "Create outcome unknown", details: { operation: "task.create" } };
  await capture(page, "Prepare #English @Homework tomorrow"); await page.getByRole("button", { name: "Create task", exact: true }).click(); await expect(page.getByRole("button", { name: "Create task", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape"); await page.keyboard.press("n"); await expect(page.getByRole("button", { name: "Create task", exact: true })).toBeDisabled();
  await expect(page.getByRole("alert").filter({ hasText: "Creation unconfirmed" })).toBeVisible(); expect(state.creates).toHaveLength(1);
  await page.getByRole("button", { name: "Discard inspected capture" }).click(); const confirm = page.getByRole("dialog", { name: "Discard this inspected capture?" }); await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(confirm).toBeHidden(); await expect(page.getByRole("dialog", { name: "Quick add", exact: true })).toBeHidden();
  await page.keyboard.press("n"); await expect(page.getByRole("textbox", { name: "Task input" })).toHaveValue("");
});


test("GitHub Inbox opens real item context and explicitly creates one linked task with mapped assignments", async ({ page }) => {
  const state = await workspace(page, true);
  await navigate(page, "Inbox");
  await expect(page.locator("h1")).toContainText("Inbox");
  await page.getByRole("button", { name: /Tomorrow #7 parser review/ }).click();
  const detail = page.getByRole("dialog", { name: "Tomorrow #7 parser review" });
  await expect(detail).toContainText("Review requirement unique external phrase");
  await expect(detail.getByRole("link", { name: "Open GitHub" })).toHaveAttribute("href", "https://github.com/owner/repo/pull/7");
  expect(state.creates).toHaveLength(0);
  await detail.getByRole("button", { name: "Create task", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Create linked task" });
  await expect(composer.locator(".preview-title")).toHaveText("Tomorrow #7 parser review");
  await composer.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(composer.getByRole("status")).toContainText("Created in Notion");
  expect(state.creates).toHaveLength(1); expect(state.creates[0]).toMatchObject({ task: { title: "Tomorrow #7 parser review", projectId: "english", areaId: "homework" }, source: { source: "github", externalId: "owner/repo:pull:7", url: "https://github.com/owner/repo/pull/7" } });
  await composer.getByRole("button", { name: "Done" }).click();
  await expect(detail.getByRole("button", { name: "Open linked task" })).toBeVisible();
  await detail.getByRole("button", { name: "Open linked task" }).click();
  await expect(page.getByRole("dialog")).toContainText("Tomorrow #7 parser review");
});

test("GitHub repository context, external search and force refresh show actual source data", async ({ page }) => {
  const state = await workspace(page, true);
  await navigate(page, "English");
  await expect(page.locator(".repository-context")).toContainText("owner/repo");
  await expect(page.locator(".repository-context")).toContainText("CI workflow success");
  await expect(page.locator(".repository-context")).toContainText("Mobile repository issue");
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: "Search", exact: true }).fill("unique external phrase");
  await page.locator(".palette-result").first().click();
  await expect(page.getByRole("dialog", { name: "Tomorrow #7 parser review" })).toContainText("Review requirement unique external phrase");
  await page.keyboard.press("Escape");
  await navigate(page, "GitHub");
  await page.getByRole("combobox", { name: "GitHub repository" }).selectOption("owner/repo");
  await expect(page.locator(".repository-context")).toContainText("Fix repository parser");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect.poll(() => state.githubReads.filter(url => url.includes("refresh=1")).length).toBeGreaterThanOrEqual(5);
  expect(state.creates).toHaveLength(0); expect(state.patches).toHaveLength(0);
});

test("Contact list/detail escapes messages, marks read/unread and confirms deletion", async ({ page, isMobile }) => {
  const state = await workspace(page, false, true); await navigate(page, "Contact");
  await expect(page.locator("h1")).toHaveText("Contact"); await page.getByRole("button", { name: /Contact Visitor Tomorrow/ }).click();
  const detail = page.locator(".contact-detail"); await expect(detail.locator(".contact-message")).toContainText("<script>alert('unsafe')</script>"); expect(await detail.locator("script").count()).toBe(0);
  await expect(detail.getByRole("link", { name: "visitor+qa@example.com" })).toHaveAttribute("href", "mailto:visitor%2Bqa%40example.com");
  if (isMobile) await expect(page.locator(".contact-list")).not.toBeVisible(); else await expect(page.locator(".contact-list")).toBeVisible();
  await detail.getByRole("button", { name: "Mark read", exact: true }).click(); await expect(detail.getByRole("button", { name: "Mark unread", exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "Mark unread", exact: true }).click(); await expect(detail.getByRole("button", { name: "Mark read", exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "Delete message" }).click(); const confirm = page.getByRole("dialog", { name: "Delete Contact message?" }); await confirm.getByRole("button", { name: "Cancel" }).click(); expect(state.contactWrites.filter(write => write.method === "DELETE")).toHaveLength(0);
  await detail.getByRole("button", { name: "Delete message" }).click(); await confirm.getByRole("button", { name: "Delete", exact: true }).click(); await expect(page.locator(".contact-row").filter({ hasText: "Contact Visitor" })).toHaveCount(0); expect(state.contactWrites).toEqual([{ id: 7, method: "PATCH", body: { is_read: true } }, { id: 7, method: "PATCH", body: { is_read: false } }, { id: 7, method: "DELETE", body: { confirmed: true } }]); expect(state.creates).toHaveLength(0);
});

test("Contact denied writes retain status; confirmed write survives denied refresh", async ({ page }) => {
  const state = await workspace(page, false, true); await navigate(page, "Contact"); await page.getByRole("button", { name: /Contact Visitor Tomorrow/ }).click(); const detail = page.locator(".contact-detail"); state.failContactWrite = true;
  await detail.getByRole("button", { name: "Mark read", exact: true }).click(); await expect(page.locator(".mutation-toast")).toContainText("Couldn't update message."); await expect(detail.getByRole("button", { name: "Mark read", exact: true })).toBeEnabled();
  state.failContactWrite = false; state.failContactRead = true; await detail.getByRole("button", { name: "Mark read", exact: true }).click(); await expect(detail.getByRole("button", { name: "Mark unread", exact: true })).toBeVisible(); await expect.poll(() => state.contactWrites.length).toBe(2);
  await page.getByRole("button", { name: "Refresh data", exact: true }).click(); await expect(page.locator(".sr-only[role=status]")).toContainText("Some sources could not be refreshed");
});

test("Contact Inbox and search open actual items; conversion is explicit and preserves source title", async ({ page }) => {
  const state = await workspace(page, false, true); await navigate(page, "Inbox"); await expect(page.locator("#workspace")).toContainText("contact / unread");
  await page.getByRole("button", { name: /Contact Visitor Tomorrow/ }).click(); const detail = page.locator(".inbox-inspector .contact-detail"); expect(state.creates).toHaveLength(0);
  await detail.getByRole("button", { name: "Create task", exact: true }).click(); const composer = page.getByRole("dialog", { name: "Create linked task" }); await expect(composer.locator(".preview-title")).toHaveText("Tomorrow #7 Contact request"); await expect(composer.getByRole("button", { name: "Create task", exact: true })).toBeDisabled();
  await composer.getByLabel("Task project", { exact: true }).selectOption("english"); await composer.getByRole("button", { name: "Create task", exact: true }).click(); await expect(composer.getByRole("status")).toContainText("Created in Notion"); expect(state.creates).toHaveLength(1); expect(state.creates[0]).toMatchObject({ task: { title: "Tomorrow #7 Contact request", projectId: "english", areaId: "homework" }, source: { source: "contact", externalId: "7", url: null } }); await composer.getByRole("button", { name: "Done" }).click(); await expect(detail.getByRole("button", { name: "Open linked task" })).toBeVisible();
  await page.keyboard.press("Escape"); await page.keyboard.press("Control+k"); await page.getByRole("textbox", { name: "Search", exact: true }).fill("unique contact phrase"); await page.locator(".palette-result").first().click(); await expect(page.locator(".inbox-inspector .contact-message")).toContainText("unique contact phrase"); expect(state.creates).toHaveLength(1);
});

test("Contact controls, loaded-page/global server search and refresh use real source requests", async ({ page }) => {
  const state = await workspace(page, false, true); await navigate(page, "Contact");
  await page.getByRole("combobox", { name: "Contact sort" }).selectOption("oldest"); await page.getByRole("combobox", { name: "Contact filter" }).selectOption("read"); await expect(page.locator(".contact-row")).toHaveCount(1); await page.getByRole("button", { name: /Read Visitor Already/ }).click(); await expect(page.locator(".contact-detail a")).toHaveCount(0);
  if (await page.locator(".contact-back").isVisible()) await page.locator(".contact-back").click();
  await page.getByRole("combobox", { name: "Contact filter" }).selectOption("all"); await page.getByRole("button", { name: "next →", exact: true }).click(); await expect(page.locator(".contact-row")).toContainText("Older Contact");
  await page.keyboard.press("Control+k"); await page.getByRole("textbox", { name: "Search", exact: true }).fill("older searchable"); await page.locator(".palette-result").first().click(); await expect(page.getByRole("dialog", { name: "Older Contact" })).toContainText("older searchable source"); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click(); await expect.poll(() => state.contactReads.filter(url => url.includes("refresh=1")).length).toBeGreaterThanOrEqual(3); expect(state.contactReads.some(url => url.includes("sort=oldest") && url.includes("page=2"))).toBe(true);
  await page.keyboard.press("Control+k"); await page.getByRole("textbox", { name: "Search", exact: true }).fill("older searchable"); await expect.poll(() => state.contactReads.some(url => url.includes("search=older+searchable"))).toBe(true); expect(state.contactWrites).toHaveLength(0);
});

test("Contact conversion can save a source-preserving draft without a Notion graph", async ({ page }) => {
  const state = await workspace(page, false, true); state.graph = { areas: [], projects: [], tasks: [], syncedAt: null }; await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await navigate(page, "Contact"); await page.getByRole("button", { name: /Contact Visitor Tomorrow/ }).click(); await page.locator(".contact-detail").getByRole("button", { name: "Create task", exact: true }).click(); const composer = page.getByRole("dialog", { name: "Create linked task" }); await expect(composer.getByRole("button", { name: "Create task", exact: true })).toBeDisabled(); await composer.getByRole("button", { name: "Save draft", exact: true }).click(); await expect.poll(() => state.local.drafts.length).toBe(1); expect(state.local.drafts[0]).toMatchObject({ source: "contact", externalId: "7", externalUrl: null, title: "Tomorrow #7 Contact request" }); expect(state.creates).toHaveLength(0);
});
