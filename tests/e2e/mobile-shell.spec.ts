import { expect, test } from "@playwright/test";
import { workspace, navigate } from "./workspace.fixture";
import { initialSnapshot } from "./startup.fixture";

test.beforeEach(async ({ context, browserName }) => {
  if (browserName === "chromium") await context.grantPermissions(["local-network-access"]);
});

test("header search, launcher and history retain the shell", async ({ page, isMobile }) => {
  test.setTimeout(60_000);
  const state = await workspace(page, true, true, false, false);
  await initialSnapshot(page, state.graph, state.local);
  await page.goto("/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  const header = await page.locator(".workspace-header").elementHandle();
  for (const view of ["Today", "Upcoming", "Settings & diagnostics", "GitHub", "Contact", "Overview"]) {
    await navigate(page, view);
    const search = page.locator(".header-search");
    await expect(search).toBeVisible();
    expect(await header!.evaluate(element => element === document.querySelector(".workspace-header"))).toBe(true);
    await search.click();
    await expect(page.locator(".palette")).toBeVisible();
    const box = (await page.locator(".palette").boundingBox())!;
    const size = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    if (isMobile) await expect(page.locator(".palette kbd:visible")).toHaveCount(0);
    else await expect(page.locator(".palette-search kbd")).toBeVisible();
    await page.locator(".palette").getByRole("button", { name: "Close", exact: true }).click();
  }
  await page.goBack();
  await expect(page.locator("h1")).toHaveText("Contact");
  await page.goForward();
  await expect(page.locator("h1")).toHaveText(/Overview/);
  await page.screenshot({ path: test.info().outputPath("overview.png") });
  await page.locator(".header-search").click();
  await page.waitForFunction(() => !document.querySelector(".palette")?.getAnimations().some(animation => animation.playState === "running"));
  await page.screenshot({ path: test.info().outputPath("launcher.png") });
});

test("mobile sidebar stays in the grid and reduced motion suppresses transitions", async ({ page, isMobile }) => {
  test.skip(!isMobile);
  await page.setViewportSize({ width: 320, height: 568 });
  const state = await workspace(page, true, true, false, false);
  await initialSnapshot(page, state.graph, state.local);
  await page.goto("/");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  const sidebar = page.locator(".desktop-sidebar");
  const toggle = sidebar.locator(".sidebar-brand-toggle");
  await expect(sidebar).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveText("[>]");
  await expect(toggle.locator(".sidebar-icon, .fa-angles-left, .fa-angles-right")).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-label", "Expand sidebar");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".shortcut-help:visible")).toHaveCount(0);
  await expect(page.locator("kbd:visible")).toHaveCount(0);
  await expect(page.locator(".mobile-list-root")).toHaveCount(0);
  const separated = await page.evaluate(() => {
    const sidebarBox = document.querySelector(".desktop-sidebar")!.getBoundingClientRect();
    const workspaceBox = document.querySelector(".workspace")!.getBoundingClientRect();
    return workspaceBox.left >= sidebarBox.right - 0.5;
  });
  expect(separated).toBe(true);
  await page.screenshot({ path: test.info().outputPath("sidebar-320.png") });
  await expect(page.locator(".workspace")).not.toHaveAttribute("inert");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await page.locator(".app-shell").evaluate(element => getComputedStyle(element).transitionDuration)).toBe("0s");
  await toggle.click();
  await expect(toggle).toHaveText("[<]");
  await expect(toggle.locator(".sidebar-icon, .fa-angles-left, .fa-angles-right")).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-label", "Collapse sidebar");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await navigate(page, "Today");
  expect(await page.locator(".view-stage").evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  await page.locator(".header-search").click();
  await expect(page.locator(".palette-search input")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("launcher-320.png") });
  await page.setViewportSize({ width: 430, height: 932 });
  await page.screenshot({ path: test.info().outputPath("launcher-430.png") });
  await page.locator(".palette").getByRole("button", { name: "Close", exact: true }).click();
  await navigate(page, "Overview");
  await page.screenshot({ path: test.info().outputPath("overview-430.png") });
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 47, bottom: 34, left: 0, right: 0 } });
  expect(await page.locator(".workspace-header").evaluate(element => getComputedStyle(element).paddingTop)).toBe("55px");
  await page.screenshot({ path: test.info().outputPath("overview-safe-area.png") });
  await page.locator(".header-search").click();
  const safeBox = (await page.locator(".palette").boundingBox())!;
  expect(safeBox.y).toBeGreaterThanOrEqual(47);
  expect(safeBox.y + safeBox.height).toBeLessThanOrEqual(932 - 34);
  await session.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, bottom: 0, left: 0, right: 0 } });
  await page.setViewportSize({ width: 320, height: 300 });
  const footer = (await page.locator(".palette-footer").boundingBox())!;
  expect(footer.y + footer.height).toBeLessThanOrEqual(300);
  await expect(page.locator(".palette-search input")).toBeVisible();
});
