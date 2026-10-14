import { expect, test } from "@playwright/test";
import { workspace } from "./workspace.fixture";
import { initialSnapshot } from "./startup.fixture";

test.beforeEach(async ({ context, browserName }) => {
  if (browserName === "chromium") await context.grantPermissions(["local-network-access"]);
});

test("late Overview source summaries do not move cached tasks", async ({ page }) => {
  const state = await workspace(page, true, true, false, false);
  await initialSnapshot(page, state.graph, state.local, "overview");
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/api\/(github|contact)\?/, async route => { await held; await route.fallback(); });
  await page.goto("/");
  const row = page.locator('.task-row[data-task-id="now"]');
  await expect(row).toBeVisible();
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await page.waitForFunction(() => !document.querySelector(".view-stage")?.getAnimations().some(animation => animation.playState === "running"));
  const before = (await row.boundingBox())!.y;
  await page.screenshot({ path: test.info().outputPath("overview-before.png") });
  release();
  await expect(page.locator(".view-stream")).toContainText("Contact 1 unread");
  const after = (await row.boundingBox())!.y;
  await page.screenshot({ path: test.info().outputPath("overview-after.png") });
  expect(after).toBe(before);
});

for (const reducedMotion of [false, true]) {
  test(`Overview handoff orders status, overlay and updated tasks${reducedMotion ? " with reduced motion" : " without animation events"}`, async ({ page }) => {
    const state = await workspace(page, false, false, false, false);
    state.local.preferences.showCompletedTasks = false;
    await initialSnapshot(page, structuredClone(state.graph), state.local, "overview");
    state.graph.tasks.find(task => task.id === "now")!.completed = true;
    state.graph.tasks.find(task => task.id === "overdue")!.title = "Updated before reveal";
    state.graph.syncedAt = "2026-10-03T12:00:01Z";
    await page.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" });
    await page.addInitScript(() => {
      new MutationObserver(() => {
        const root = document.documentElement;
        if (document.querySelector('.task-row[data-task-id="now"]')) root.dataset.staleTaskShown = "true";
        if (document.querySelector('.boot-status [data-step="notion"].done')) root.dataset.notionDoneAt ??= String(Date.now());
        if (document.querySelector('.boot-status [data-step="prepare"].done')) root.dataset.prepareDoneAt ??= String(Date.now());
      }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let requested = false;
    await page.route("**/api/graph?*", async route => { requested = true; await held; await route.fallback(); });
    await page.goto("/");
    await expect.poll(() => requested).toBe(true);
    const splash = page.locator(".boot-screen");
    const notion = splash.locator('[data-step="notion"]');
    const prepare = splash.locator('[data-step="prepare"]');
    const row = page.locator('.task-row[data-task-id="overdue"]');
    await expect(splash).toBeVisible();
    await expect(prepare).toContainText("Preparing Overview");
    await expect(page.locator(".workspace")).toHaveCount(0);
    await page.clock.install();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    const response = page.waitForResponse(reply => new URL(reply.url()).pathname === "/api/graph");
    release();
    await (await response).finished();
    await expect.poll(async () => { await page.clock.runFor(1); return notion.getAttribute("class"); }).toContain("done");
    await expect(notion.locator(".boot-marker")).toHaveText("[✓]");
    await expect(prepare).toHaveClass(/active/);
    await expect(row).toContainText("Updated before reveal");
    await expect(page.locator(".startup-workspace")).toHaveAttribute("inert", "");
    await expect(page.locator("html")).not.toHaveAttribute("data-stale-task-shown", "true");
    const before = await row.boundingBox();
    const liveRegion = await page.locator(".boot-status").elementHandle();
    expect(await splash.boundingBox()).toEqual({ x: 0, y: 0, ...page.viewportSize()! });
    expect(await row.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return !!document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest(".boot-screen");
    })).toBe(true);
    const notionAt = Number(await page.locator("html").getAttribute("data-notion-done-at"));
    const now = await page.evaluate(() => Date.now());
    await page.clock.runFor(notionAt + 249 - now);
    await expect(prepare).toHaveClass(/active/);
    await expect(splash).toHaveAttribute("data-phase", "waiting");
    await page.clock.runFor(1);
    await expect(prepare.locator(".boot-marker")).toHaveText("[✓]");
    await expect(splash).toHaveAttribute("data-phase", "holding");
    await page.clock.runFor(199);
    await expect(splash).toHaveAttribute("data-phase", "holding");
    await expect(splash).toHaveCSS("opacity", "1");
    await page.clock.runFor(1);

    if (reducedMotion) {
      await page.clock.runFor(1);
      await expect(splash).toHaveCount(0);
    } else {
      await expect(prepare.locator(".boot-marker")).toHaveText("[✓]");
      await expect(splash).toHaveAttribute("data-phase", "exiting");
      const timing = await splash.evaluate(element => element.getAnimations({ subtree: true }).map(animation => {
        animation.pause(); // No animationend can complete the handoff in this test.
        animation.currentTime = 0;
        return { duration: animation.effect!.getTiming().duration };
      }));
      expect(timing).toHaveLength(2);
      expect(timing.every(animation => animation.duration === 320)).toBe(true);
      await expect(splash).toHaveCSS("opacity", "1");
      await expect(splash.locator(".boot-content")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
      await splash.evaluate(element => element.getAnimations({ subtree: true }).forEach(animation => { animation.currentTime = 160; }));
      const middle = await splash.evaluate(element => ({ opacity: Number(getComputedStyle(element).opacity), scale: new DOMMatrix(getComputedStyle(element.querySelector(".boot-content")!).transform).a }));
      expect(middle.opacity).toBeGreaterThan(0);
      expect(middle.opacity).toBeLessThan(1);
      expect(middle.scale).toBeGreaterThan(1);
      expect(middle.scale).toBeLessThan(2);
      await page.screenshot({ path: test.info().outputPath("handoff-midpoint.png") });
      await splash.evaluate(element => element.getAnimations({ subtree: true }).forEach(animation => { animation.currentTime = 320; }));
      await expect(splash).toHaveCSS("opacity", "0");
      await expect(splash.locator(".boot-content")).toHaveCSS("transform", "matrix(2, 0, 0, 2, 0, 0)");
      await page.clock.runFor(319);
      await expect(splash).toHaveCount(1);
      await page.clock.runFor(1);
      await expect(splash).toHaveCount(0);
    }
    const prepareAt = Number(await page.locator("html").getAttribute("data-prepare-done-at"));
    expect(prepareAt - notionAt).toBe(250);
    expect(await row.boundingBox()).toEqual(before);
    expect(await liveRegion!.evaluate(element => element === document.querySelector(".startup-announcement .boot-status"))).toBe(true);
    await expect(page.locator(".startup-announcement")).toContainText("Workspace ready");
    await expect(page.locator(".startup-workspace")).not.toHaveAttribute("inert", "");
    await expect(page.locator("html")).not.toHaveAttribute("data-stale-task-shown", "true");
    await page.clock.resume();
    await page.screenshot({ path: test.info().outputPath("handoff-finished.png") });
  });
}

for (const failure of [false, true]) {
  test(`cached workspace waits for ${failure ? "a failed" : "a successful"} first task check and stays open during later refreshes`, async ({ page }) => {
    const state = await workspace(page, false, false, false, false);
    state.local.preferences.showCompletedTasks = false;
    await initialSnapshot(page, structuredClone(state.graph), state.local);
    state.graph.tasks.find(task => task.id === "now")!.completed = true;
    state.graph.syncedAt = "2026-10-03T12:00:01Z";
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let released = false;
    const reads: string[] = [];
    await page.addInitScript(() => {
      new MutationObserver(() => {
        if (document.querySelector('.task-row[data-task-id="now"]')) document.documentElement.dataset.staleTaskShown = "true";
      }).observe(document, { childList: true, subtree: true });
    });
    await page.route("**/api/graph?*", async route => {
      reads.push(route.request().url());
      if (!released) {
        await held;
        if (failure) return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { code: "NOTION_UNAVAILABLE", message: "Refresh failed" } }) });
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ mode: "delta", revision: state.graph.syncedAt, tasks: [state.graph.tasks.find(task => task.id === "now")], projects: [], areas: [], deletedTaskIds: [], deletedProjectIds: [], deletedAreaIds: [], diagnostics: [{ source: "notion", status: "ok", message: "Startup delta verified" }], completionEnabled: true }) });
      }
      return route.fallback();
    });
    await page.goto("/");
    await expect.poll(() => reads.length).toBeGreaterThan(0);
    expect(new URL(reads[0]).searchParams.get("startup")).toBe("1");
    expect(new URL(reads[0]).searchParams.get("since")).toBe("2026-10-03T12:00:00Z");
    const stale = page.locator('.task-row[data-task-id="now"]');
    await expect(page.locator(".boot-screen")).toBeVisible();
    await expect(page.locator(".workspace")).toHaveCount(0);
    await expect(stale).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveAttribute("data-stale-task-shown", "true");
    released = true; release();
    if (failure) {
      await expect(stale).toBeVisible();
      await expect(page.locator(".connection-notice")).toContainText("Notion refresh failed");
    } else {
      await expect(page.locator('.task-row[data-task-id="overdue"]')).toBeVisible();
      await expect(stale).toHaveCount(0);
      await expect(page.locator("html")).not.toHaveAttribute("data-stale-task-shown", "true");
    }
    await expect(page.locator(".boot-screen")).toHaveCount(0);

    let releasePoll!: () => void;
    await page.clock.install();
    const poll = new Promise<void>(resolve => { releasePoll = resolve; });
    await page.route("**/api/graph?*", async route => { await poll; return route.fallback(); });
    const nextRead = page.waitForRequest(request => new URL(request.url()).pathname === "/api/graph");
    await page.clock.runFor(15_000);
    const request = await nextRead;
    expect(new URL(request.url()).searchParams.has("startup")).toBe(false);
    await expect(page.locator(".boot-screen")).toHaveCount(0);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator('.task-row[data-task-id="overdue"]')).toBeVisible();
    releasePoll();
    await expect(stale).toHaveCount(0);

    let releaseRefresh!: () => void;
    const manualRefresh = new Promise<void>(resolve => { releaseRefresh = resolve; });
    await page.route("**/api/graph?refresh=1", async route => { await manualRefresh; return route.fallback(); });
    const refreshRead = page.waitForRequest(request => new URL(request.url()).searchParams.get("refresh") === "1");
    await page.getByRole("button", { name: "Refresh data", exact: true }).click();
    await refreshRead;
    await expect(page.locator(".boot-screen")).toHaveCount(0);
    await expect(page.locator('.task-row[data-task-id="overdue"]')).toBeVisible();
    releaseRefresh();
    await expect(page.locator('[role="status"]')).toContainText(["Refresh complete."]);
  });
}

test("without graph cache the splash waits for tasks, then releases once", async ({ page }) => {
  const state = await workspace(page, false, false, false, false);
  await initialSnapshot(page, undefined, state.local, "overview");
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  await page.route("**/api/graph?*", async route => { reads++; await held; await route.fallback(); });
  await page.goto("/");
  await expect.poll(() => reads).toBeGreaterThan(0);
  await expect(page.locator(".boot-screen")).toBeVisible();
  await expect(page.locator(".workspace-header")).toHaveCount(0);
  const log = page.locator(".boot-status");
  await expect(log).toHaveAttribute("aria-live", "polite");
  await expect(log).toContainText("Local workspace restored");
  await expect(log.locator('[data-step="cache"]')).toHaveCount(0);
  const notion = log.locator('[data-step="notion"]');
  await expect(notion).toContainText("Connecting to Notion_");
  await expect(notion.locator(".boot-marker")).toHaveText(/\[[-|/\\]\]/);
  await expect(log).not.toContainText("Notion data loaded");
  await expect(log).not.toContainText("GitHub");
  await expect(log).not.toContainText("Contact");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(notion.locator(".boot-marker")).toHaveText("[-]");
  await page.clock.install();
  await page.clock.runFor(800);
  await expect(notion.locator(".boot-marker")).toHaveText("[-]");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  for (const frame of ["[|]", "[/]", "[\\]", "[-]"]) {
    await page.clock.runFor(200);
    await expect(notion.locator(".boot-marker")).toHaveText(frame);
  }
  release();
  await page.clock.resume();
  await expect(page.locator('.task-row[data-task-id="now"]')).toBeVisible();
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator(".startup-announcement")).toContainText("Notion data loaded · 5 tasks · 2 projects · 2 areas");
  await expect(page.locator(".startup-announcement")).toContainText("Workspace ready");
});

for (const response of ["success", "request-error", "saved-response", "offline-response"] as const) {
  test(`terminal loader reports cached startup ${response} while required Contact loads`, async ({ page }) => {
    const state = await workspace(page, false, true, false, false);
    await initialSnapshot(page, state.graph, state.local, "contact");
    let releaseGraph!: () => void, releaseContact!: () => void;
    const graphHeld = new Promise<void>(resolve => { releaseGraph = resolve; });
    const contactHeld = new Promise<void>(resolve => { releaseContact = resolve; });
    await page.route("**/api/graph?*", async route => {
      await graphHeld;
      if (response === "request-error") return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { code: "NOTION_UNAVAILABLE", message: "private-page-id credential task-title" } }) });
      if (response === "saved-response" || response === "offline-response") return route.fulfill({ contentType: "application/json", headers: response === "offline-response" ? { "X-Taesks-Offline": "1", "X-Taesks-Cached-At": state.graph.syncedAt! } : {}, body: JSON.stringify({ mode: "snapshot", response: { graph: state.graph, completionEnabled: true, diagnostics: [{ source: "notion", status: response === "saved-response" ? "error" : "ok", message: "private-page-id credential task-title" }] } }) });
      return route.fallback();
    });
    await page.route("**/api/contact?*", async route => { await contactHeld; return route.fallback(); });
    await page.goto("/");
    const log = page.locator(".boot-status"), notion = log.locator('[data-step="notion"]');
    await expect(log).toContainText("Cached Notion graph restored");
    await expect(notion).toContainText("Connecting to Notion_");
    await expect(log).toContainText("Connecting to Contact_");
    await expect(log).toContainText("Preparing Contact_");
    await expect(log).not.toContainText("GitHub");
    releaseGraph();
    if (response === "success") {
      await expect(notion).toContainText("Notion data loaded · 5 tasks · 2 projects · 2 areas");
      await expect(notion.locator(".boot-marker")).toHaveText("[✓]");
      await expect(notion.locator(".boot-cursor")).toHaveCount(0);
    } else {
      await expect(notion).toContainText("Notion unavailable · showing saved data");
      await expect(notion.locator(".boot-marker")).toHaveText("[!]");
      await expect(log).not.toContainText("Notion data loaded");
    }
    await expect(log).not.toContainText("private-page-id");
    await expect(log).not.toContainText("credential");
    await expect(log).not.toContainText("task-title");
    await page.screenshot({ path: test.info().outputPath("terminal-loader.png") });
    releaseContact();
    await expect(page.locator("h1")).toHaveText("Contact");
    await expect(page.locator(".boot-screen")).toHaveCount(0);
    await expect(page.locator(".startup-announcement")).toContainText(response === "success" ? "Workspace ready" : "Workspace ready in offline mode");
  });
}

test("Notion failure without a saved graph shows a clear error and can retry", async ({ page }) => {
  const state = await workspace(page, false, false, false, false);
  state.local.notes = []; state.local.attachments = []; state.local.links = [];
  await initialSnapshot(page, undefined, state.local);
  state.failGraph = true;
  await page.goto("/");
  await expect(page.locator(".boot-status")).toContainText("Notion unavailable · no saved data available");
  await expect(page.locator(".boot-status .boot-cursor")).toHaveCount(0);
  await expect(page.locator(".boot-status")).not.toContainText("Workspace ready");
  await expect(page.locator(".workspace")).toHaveCount(0);
  state.failGraph = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator('.task-row[data-task-id="now"]')).toBeVisible();
  await expect(page.locator(".boot-screen")).toHaveCount(0);
});

test("local restoration failure stops loading safely and retries without leaking error details", async ({ page }) => {
  const state = await workspace(page, false, false, false, false);
  await initialSnapshot(page, undefined, undefined);
  let failLocal = true;
  await page.route("**/api/local", route => failLocal && route.request().method() === "GET" ? route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { code: "LOCAL_ERROR", message: "secret-token private-page-id" } }) }) : route.fallback());
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(page.locator(".boot-status")).toContainText("Local workspace unavailable");
  await expect(page.locator(".boot-cursor")).toHaveCount(0);
  await expect(page.locator(".boot-status")).not.toContainText("secret-token");
  await expect(page.locator(".boot-status")).not.toContainText("private-page-id");
  await expect(page.locator(".workspace")).toHaveCount(0);
  failLocal = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator("h1")).toHaveText(/Today/);
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  expect(state.graph.tasks).toHaveLength(5);
});

for (const failure of [false, true]) {
  test(`Contact startup waits for its uncached source and opens after ${failure ? "failure" : "success"}`, async ({ page }) => {
    const state = await workspace(page, false, true, false, false);
    await initialSnapshot(page, state.graph, state.local, "contact");
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let reads = 0;
    await page.route("**/api/contact?*", async route => {
      reads++; await held;
      if (failure) return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { code: "CONTACT_UNAVAILABLE", message: "Source unavailable" } }) });
      await route.fallback();
    });
    await page.goto("/");
    await expect.poll(() => reads).toBeGreaterThan(0);
    await expect(page.locator(".boot-screen")).toBeVisible();
    release();
    await expect(page.locator("h1")).toHaveText("Contact");
    await expect(page.locator(".boot-screen")).toHaveCount(0);
    if (failure) await expect(page.locator(".contact-view")).toContainText("Source unavailable");
    else await expect(page.locator(".contact-row")).toHaveCount(2);
  });
}

for (const cached of [true, false]) {
test(`device drafts are included in the first visible Inbox ${cached ? "with a cache" : "without a graph and after Notion failure"} and remain stored offline`, async ({ page }) => {
  const state = await workspace(page, false, false, false, false);
  await initialSnapshot(page, cached ? state.graph : undefined, state.local, "inbox");
  state.failGraph = !cached;
  if (!cached) { state.local.notes = []; state.local.attachments = []; state.local.links = []; }
  const draft = { id: "device-start", title: "Device startup draft", input: "Device startup draft", areaId: null, projectId: null, dates: { start: null, end: null }, priority: "none", tags: [], recurrenceRule: null, source: "quick-add", externalId: null, externalUrl: null, createdAt: state.graph.syncedAt, updatedAt: state.graph.syncedAt };
  await page.addInitScript(entry => {
    // Keep dev assets reachable while exercising the client's offline draft path.
    Object.defineProperty(navigator, "onLine", { get: () => false });
    localStorage.setItem("taesks.device-draft.device-start", JSON.stringify(entry));
    new MutationObserver(() => {
      if (!document.documentElement.dataset.firstWorkspaceDraft && document.querySelector(".workspace-header") && !document.querySelector(".boot-screen")) {
        document.documentElement.dataset.firstWorkspaceDraft = String(document.querySelector(".draft-row")?.textContent?.includes("Device startup draft"));
      }
    }).observe(document, { childList: true, subtree: true });
  }, { draft, revision: "954d0101-515b-429d-a376-6c4867c9891a", operation: "save" });
  await page.goto("/");
  await expect(page.locator(".draft-row")).toContainText("Device startup draft");
  await expect(page.locator("html")).toHaveAttribute("data-first-workspace-draft", "true");
  expect(await page.evaluate(() => localStorage.getItem("taesks.device-draft.device-start"))).toContain("Device startup draft");
});
}
