import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { workspace, navigate, makeTask } from "./workspace.fixture";
import { initialSnapshot } from "./startup.fixture";

async function expectGrid(page: Page) {
  const sidebar = page.locator(".desktop-sidebar");
  const content = page.locator(".workspace");
  await expect(sidebar).toBeVisible();
  await expect(content).not.toHaveAttribute("inert");
  await expect(page.locator(".mobile-list-root, .mobile-sidebar-toggle, .collapsed-menu")).toHaveCount(0);
  await expect(content.getByRole("button", { name: /(?:Expand|Collapse) sidebar|Open lists/ })).toHaveCount(0);
  await expect.poll(async () => {
    const viewportWidth = page.viewportSize()!.width;
    return page.evaluate((width) => {
      const left = document.querySelector(".desktop-sidebar")!.getBoundingClientRect();
      const right = document.querySelector(".workspace")!.getBoundingClientRect();
      const collapsed = document.querySelector(".app-shell")!.classList.contains("sidebar-collapsed");
      const mobile = width <= 760;
      return left.width > 0 && right.right <= width + 1 && (mobile
        ? Math.abs(right.left - 60) <= 0.5 && (collapsed ? Math.abs(left.right - right.left) <= 0.5 : left.right > right.left)
        : right.left >= left.right - 0.5);
    }, viewportWidth);
  }).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
}

async function watchGridTransition(page: Page) {
  await page.evaluate(() => {
    const mobile = matchMedia("(max-width: 760px)").matches;
    const shell = document.querySelector(mobile ? ".desktop-sidebar" : ".app-shell")!;
    shell.addEventListener("transitionrun", event => {
      if ((event as TransitionEvent).propertyName !== (mobile ? "width" : "grid-template-columns")) return;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const sidebar = document.querySelector(".desktop-sidebar")!.getBoundingClientRect();
        const workspace = document.querySelector(".workspace")!.getBoundingClientRect();
        document.documentElement.dataset.sidebarTransitionSample = JSON.stringify({
          width: sidebar.width,
          separated: workspace.left >= sidebar.right - 0.5,
          workspaceLeft: workspace.left,
          workspaceWidth: workspace.width,
        });
      }));
    }, { once: true });
  });
}

for (const initialCollapsed of [false, true]) {
  test("sidebar preserves the workspace layout and persists both states, initially " + (initialCollapsed ? "compact" : "expanded"), async ({ page, isMobile }) => {
    if (isMobile) await page.setViewportSize({ width: 320, height: 568 });
    const state = await workspace(page, false, false, false, false);
    state.local.preferences.sidebarCollapsed = initialCollapsed;
    await initialSnapshot(page, state.graph, state.local);
    await page.goto("/?view=today");
    const sidebar = page.locator(".desktop-sidebar");
    const toggle = sidebar.locator(".sidebar-brand-toggle");
    await expect(page.locator("h1")).toHaveText(/Today/);
    const url = page.url();
    const originalToggle = await toggle.elementHandle();
    async function expectState(collapsed: boolean) {
      await page.waitForFunction(() =>
        !document.querySelector(".app-shell")?.getAnimations({ subtree: true }).some(animation => animation.playState === "running"),
      );
      await expectGrid(page);
      await expect(toggle).toHaveText(collapsed ? "[>]" : "[<]");
      await expect(toggle.locator(".sidebar-icon, .fa-angles-left, .fa-angles-right")).toHaveCount(0);
      await expect(toggle).toHaveAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
      await expect(toggle).toHaveAttribute("title", collapsed ? "Expand sidebar" : "Collapse sidebar");
      await expect(toggle).toHaveAttribute("aria-expanded", String(!collapsed));
      await expect(toggle).toHaveAttribute("aria-controls", "sidebar-lists");
      await expect(toggle.locator("svg")).toHaveCount(0);
      await expect(sidebar.getByRole("button", { name: "New task" }).locator(".fa-plus")).toBeVisible();
      await expect(sidebar.locator("svg")).toHaveCount(0);
      await expect(sidebar.getByRole("button", { name: /Today/ })).toHaveAttribute("aria-current", "page");
      await expect(sidebar.getByRole("button", { name: /Settings & diagnostics/ })).toBeVisible();
      const settings = (await sidebar.getByRole("button", { name: /Settings & diagnostics/ }).boundingBox())!;
      const bounds = (await sidebar.boundingBox())!;
      expect(settings.y).toBeGreaterThanOrEqual(bounds.y + bounds.height - 120);
      expect(settings.y + settings.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      await expect(sidebar.getByRole("button", { name: "Shortcuts" })).toBeVisible({ visible: !isMobile });
      await expect(sidebar.locator(".nav-scroll>section:visible")).toHaveCount(collapsed ? 0 : 4);
      if (collapsed) {
        await expect(sidebar.locator(".nav-label:visible, .nav-count:visible, .brand:visible")).toHaveCount(0);
        await expect(sidebar.locator(".search-trigger>span")).toBeHidden();
        const icons = sidebar.locator(".nav-scroll .nav-symbol:visible .sidebar-icon");
        await expect(icons).toHaveCount(7);
        for (const [index, name] of ["table-columns", "inbox", "sun", "calendar-week", "calendar-days", "infinity", "moon"].entries()) {
          await expect(icons.nth(index)).toHaveClass(new RegExp(`fa-${name}`));
        }
        const plus = (await sidebar.getByRole("button", { name: "New task" }).boundingBox())!;
        const control = (await toggle.boundingBox())!;
        // The current 60px rail stacks its two header actions.
        expect(Math.abs(plus.x + plus.width / 2 - control.x - control.width / 2)).toBeLessThanOrEqual(1.5);
        expect(plus.y + plus.height).toBeLessThanOrEqual(control.y);
        expect(control.x + control.width + 2).toBeLessThanOrEqual(bounds.x + bounds.width);
        expect((await sidebar.boundingBox())!.width).toBeLessThanOrEqual(100);
      }
      await expect(page).toHaveURL(url);
      await expect(page.locator("h1")).toHaveText(/Today/);
    }
    await expectState(initialCollapsed);
    await page.screenshot({ path: test.info().outputPath("sidebar-initial.png") });
    const initialWidth = (await sidebar.boundingBox())!.width;
    const initialContent = (await page.locator(".workspace").boundingBox())!;
    await watchGridTransition(page);
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => state.local.preferences.sidebarCollapsed).toBe(!initialCollapsed);
    await expect.poll(async () => page.locator("html").getAttribute("data-sidebar-transition-sample")).not.toBeNull();
    const transitionSample = JSON.parse((await page.locator("html").getAttribute("data-sidebar-transition-sample"))!) as { width: number; separated: boolean; workspaceLeft: number; workspaceWidth: number };
    if (isMobile) {
      expect(transitionSample.workspaceLeft).toBe(initialContent.x);
      expect(transitionSample.workspaceWidth).toBe(initialContent.width);
    } else expect(transitionSample.separated).toBe(true);
    expect(initialCollapsed ? transitionSample.width > initialWidth : transitionSample.width < initialWidth).toBe(true);
    await expectState(!initialCollapsed);
    if (isMobile) {
      const content = (await page.locator(".workspace").boundingBox())!;
      expect(content.x).toBe(initialContent.x);
      expect(content.width).toBe(initialContent.width);
    }
    await expect(toggle).toBeFocused();
    expect(await originalToggle!.evaluate(element => element === document.querySelector(".sidebar-brand-toggle"))).toBe(true);
    const changedWidth = (await sidebar.boundingBox())!.width;
    expect(initialCollapsed ? changedWidth > initialWidth : changedWidth < initialWidth).toBe(true);
    await page.screenshot({ path: test.info().outputPath("sidebar-toggled.png") });
    await page.reload();
    await expectState(!initialCollapsed);
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect.poll(() => state.local.preferences.sidebarCollapsed).toBe(initialCollapsed);
    await expectState(initialCollapsed);
    await expect(toggle).toBeFocused();
    await page.reload();
    await expectState(initialCollapsed);
    await sidebar.getByRole("button", { name: /Upcoming/ }).click();
    await expect(page.locator("h1")).toHaveText(/Upcoming/);
    await expect(sidebar.getByRole("button", { name: /Upcoming/ })).toHaveAttribute("aria-current", "page");
    expect(state.local.preferences.sidebarCollapsed).toBe(initialCollapsed);
    await expectGrid(page);
  });
}

test("compact search, creation, settings and project context stay accessible", async ({ page }) => {
  const state = await workspace(page, false, false, false, false);
  state.local.preferences.sidebarCollapsed = true;
  await initialSnapshot(page, state.graph, state.local);
  await page.goto("/?view=today");
  const sidebar = page.locator(".desktop-sidebar");
  await sidebar.getByRole("button", { name: "Today", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(sidebar.getByRole("button", { name: "Next 7 days", exact: true })).toBeFocused();
  await sidebar.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".palette")).toBeVisible();
  await page.keyboard.press("Escape");
  await sidebar.getByRole("button", { name: "New task" }).click();
  await expect(page.getByRole("dialog", { name: "Quick add" })).toBeVisible();
  await page.keyboard.press("Escape");
  await sidebar.getByRole("button", { name: "Settings & diagnostics", exact: true }).click();
  await expect(page.locator("h1")).toHaveText(/Settings/);
  await expect(sidebar.getByRole("button", { name: "Settings & diagnostics", exact: true })).toHaveAttribute("aria-current", "page");
  await navigate(page, "Homework / English");
  await expect(page.locator(".header-current")).toContainText("English");
  await expect(sidebar.getByRole("button", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "location");
  const url = page.url();
  await sidebar.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(sidebar.locator(".nav-row.indented.active")).toContainText("English");
  await expect(page).toHaveURL(url);
  await expectGrid(page);
});

test("active project connectors align with the row and keep inactive branches unchanged", async ({ page, isMobile }) => {
  const state = await workspace(page, false, false, false, false);
  await initialSnapshot(page, state.graph, state.local);
  await page.goto("/?view=today");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  const sidebar = page.locator(".desktop-sidebar");
  const rows = sidebar.locator(".area-tree").first().locator(".nav-row.indented");
  const metrics = () => rows.evaluateAll(elements => elements.map(element => {
    const before = getComputedStyle(element, "::before"), after = getComputedStyle(element, "::after");
    const rect = element.getBoundingClientRect();
    return { height: rect.height, left: rect.left,
      before: { left: parseFloat(before.left), top: parseFloat(before.top), height: parseFloat(before.height), width: parseFloat(before.width), radius: parseFloat(before.borderTopLeftRadius), border: before.borderLeftWidth },
      after: { left: parseFloat(after.left), top: parseFloat(after.top), height: parseFloat(after.height), width: parseFloat(after.width), radius: parseFloat(after.borderTopRightRadius), border: after.borderTopWidth },
      iconLeft: element.querySelector(".nav-symbol")!.getBoundingClientRect().left };
  }));
  const inactive = await metrics();
  expect(inactive).toHaveLength(2);
  // Exercise both a continuing branch and the last child's shortened vertical.
  for (const index of [0, 1]) {
    await rows.nth(index).click();
    await expect(rows.nth(index)).toHaveClass(/active/);
    const current = await metrics(), connector = current[index];
    expect(connector.before.top).toBe(0);
    // Chromium rounds percentage geometry to layout subpixels.
    expect(connector.before.height).toBeCloseTo(connector.height * (index === 1 ? .5 : 1), 1);
    expect(connector.before.left).toBe(isMobile ? 22 : 16);
    expect(connector.before.width).toBe(1);
    expect(connector.before.radius).toBe(1);
    expect(connector.after.left).toBe(connector.before.left);
    expect(connector.after.top + connector.after.height / 2).toBeCloseTo(connector.height / 2, 1);
    expect(connector.after.radius).toBe(1);
    expect(connector.left + connector.after.left + connector.after.width).toBeLessThan(connector.iconLeft);
    expect(current[1 - index]).toEqual(inactive[1 - index]);
    await expect(sidebar.locator(".area-tree.context-active")).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath(`active-connector-${index}.png`) });
  }
});

for (const input of ["mouse", "touch"] as const) {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`mobile outside ${input} only dismisses the sidebar with motion ${reducedMotion}`, async ({ page, isMobile }) => {
      test.skip(!isMobile, "Mobile outside interaction only.");
      await page.emulateMedia({ reducedMotion });
      await page.setViewportSize({ width: 390, height: 844 });
      const state = await workspace(page, false, false, false, false);
      await initialSnapshot(page, state.graph, state.local);
      await page.goto("/?view=today");
      await expect(page.locator(".boot-screen")).toHaveCount(0);
      const sidebar = page.locator(".desktop-sidebar");
      const toggle = sidebar.locator(".sidebar-brand-toggle");
      const action = page.locator(".workspace .header-add");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      const url = page.url();
      await action.evaluate(element => {
        element.setAttribute("data-pointer-events", "0");
        for (const type of ["pointerdown", "pointerup", "click"]) element.addEventListener(type, () => {
          element.setAttribute("data-pointer-events", String(Number(element.getAttribute("data-pointer-events")) + 1));
        });
      });
      const bounds = (await action.boundingBox())!;
      const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      expect(point.x).toBeGreaterThan((await sidebar.boundingBox())!.width);
      const tap = () => input === "touch" ? page.touchscreen.tap(point.x, point.y) : page.mouse.click(point.x, point.y);
      await tap();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect.poll(() => state.local.preferences.sidebarCollapsed).toBe(true);
      await expect(page.locator(".mobile-sidebar-dismiss")).toHaveCount(0);
      await expect(page).toHaveURL(url);
      await expect(page.locator("h1")).toHaveText(/Today/);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(action).toHaveAttribute("data-pointer-events", "0");
      await tap();
      await expect(page.getByRole("dialog", { name: "Quick add" })).toBeVisible();
      await expect(action).toHaveAttribute("data-pointer-events", "3");
      await page.keyboard.press("Escape");
      // An already compact rail does not intercept subsequent workspace input.
      await tap();
      await expect(page.getByRole("dialog", { name: "Quick add" })).toBeVisible();
    });
  }
}

test("expanded desktop sidebar does not intercept workspace clicks", async ({ page, isMobile }) => {
  test.skip(isMobile, "Desktop behavior only.");
  const state = await workspace(page, false, false, false, false);
  await initialSnapshot(page, state.graph, state.local);
  await page.goto("/?view=today");
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator(".mobile-sidebar-dismiss")).toBeHidden();
  await page.locator(".workspace .header-add").click();
  await expect(page.getByRole("dialog", { name: "Quick add" })).toBeVisible();
  expect(state.local.preferences.sidebarCollapsed).toBe(false);
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`mobile overlay, Area hierarchy and scrolling remain stable with motion ${reducedMotion}`, async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile layout coverage; desktop is covered by the persistence tests.");
    await page.emulateMedia({ reducedMotion });
    const state = await workspace(page, false, false, false, false);
    state.local.preferences.sidebarCollapsed = true;
    for (let index = 0; index < 35; index++) state.graph.tasks.push(makeTask(`scroll-${index}`, `Scrollable task ${index}`, "2026-10-01", "2026-12-01"));
    await initialSnapshot(page, state.graph, state.local);
    await page.goto("/?view=today");
    const sidebar = page.locator(".desktop-sidebar");
    const toggle = sidebar.locator(".sidebar-brand-toggle");
    const content = page.locator(".workspace");
    const waitForSidebar = () => sidebar.evaluate(async element => {
      await Promise.all(element.getAnimations().map(animation => animation.finished));
    });
    for (const width of [320, 390, 600, 760]) {
      await page.setViewportSize({ width, height: 844 });
      const before = (await content.boundingBox())!;
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await waitForSidebar();
      await expectGrid(page);
      const after = (await content.boundingBox())!;
      expect({ x: after.x, width: after.width }).toEqual({ x: before.x, width: before.width });
      const hierarchy = await sidebar.locator(".area-tree").first().evaluate(element => {
        const area = element.querySelector(".area-tree-header .nav-symbol")!.getBoundingClientRect();
        const project = element.querySelector(".nav-row.indented .nav-symbol")!.getBoundingClientRect();
        const toggle = element.querySelector(".tree-toggle")!.getBoundingClientRect();
        const row = element.querySelector(".nav-row.indented")!;
        const connector = getComputedStyle(row, "::after");
        const rect = row.getBoundingClientRect();
        return { inset: toggle.left, areaLeft: area.left, projectLeft: project.left, touchWidth: toggle.width, touchHeight: toggle.height,
          connectorLeft: rect.left + parseFloat(connector.left), connectorWidth: parseFloat(connector.width), connectorStyle: connector.borderTopStyle,
          topElement: document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest(".desktop-sidebar")?.id };
      });
      expect(hierarchy.inset).toBeGreaterThanOrEqual(16);
      expect(hierarchy.projectLeft).toBeGreaterThan(hierarchy.areaLeft);
      expect(hierarchy.touchWidth).toBeGreaterThanOrEqual(44);
      expect(hierarchy.touchHeight).toBeGreaterThanOrEqual(44);
      expect(hierarchy.connectorStyle).toBe("solid");
      expect(hierarchy.connectorLeft + hierarchy.connectorWidth).toBeLessThan(hierarchy.projectLeft);
      expect(hierarchy.topElement).toBe("desktop-sidebar");
      await page.screenshot({ path: test.info().outputPath(`mobile-overlay-${width}.png`) });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await waitForSidebar();
      await expectGrid(page);
      if (reducedMotion === "reduce") expect(await sidebar.evaluate(element => getComputedStyle(element).transitionDuration)).toBe("0s");
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const header = page.locator(".workspace-header");
    expect((await header.boundingBox())!.height).toBe(65);
    const mainTop = (await page.locator("main").boundingBox())!.y;
    await page.evaluate(() => window.scrollTo(0, 180));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(180);
    expect((await header.boundingBox())!.y).toBe(0);
    expect((await page.locator("main").boundingBox())!.y).toBe(mainTop - 180);
    expect(await header.evaluate(element => getComputedStyle(element).backdropFilter)).toBe("blur(4px)");
    expect(await header.evaluate(element => getComputedStyle(element, "::after").maskImage)).toContain("linear-gradient");
    await page.screenshot({ path: test.info().outputPath("mobile-top-glass-scrolled.png") });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await waitForSidebar();
    expect((await sidebar.boundingBox())!.y).toBe(0);
    await expectGrid(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sidebar.locator(".nav-row.indented").first().click();
    await expect(sidebar.locator(".nav-row.indented.active")).toContainText("English");
    await expect(sidebar.locator(".area-tree.context-active")).toHaveCount(1);
    await page.setViewportSize({ width: 1100, height: 844 });
    await expectGrid(page);
    expect(await sidebar.evaluate(element => getComputedStyle(element).position)).toBe("sticky");
    expect(await header.evaluate(element => getComputedStyle(element).backdropFilter)).toBe("none");
  });
}

test("mobile overlay respects simulated safe areas in both themes", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Safe-area simulation for the mobile CSS only.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await workspace(page, false, false, false, false);
  state.local.preferences.sidebarCollapsed = true;
  await initialSnapshot(page, state.graph, state.local);
  await page.goto("/?view=today");
  await expect(page.locator(".desktop-sidebar")).toBeVisible();
  // Chromium supplies zero device insets. Substitute them in the actual stylesheet,
  // without adding a test-only safe-area interface to the application.
  const insets = { top: 24, right: 18, bottom: 20, left: 12 };
  const css = readFileSync("src/app/globals.css", "utf8").replace('@import "tailwindcss";', "")
    .replace(/env\(safe-area-inset-(top|right|bottom|left)\)/g, (_match, side: keyof typeof insets) => `${insets[side]}px`);
  await page.addStyleTag({ content: css });
  const sidebar = page.locator(".desktop-sidebar"), toggle = sidebar.locator(".sidebar-brand-toggle");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    const before = (await page.locator(".workspace").boundingBox())!;
    expect(before.x).toBe(72);
    expect((await page.locator(".workspace-header").boundingBox())!.height).toBe(89);
    expect(await page.locator(".workspace-header").evaluate(element => getComputedStyle(element).paddingRight)).toBe("18px");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const after = (await page.locator(".workspace").boundingBox())!;
    expect({ x: after.x, width: after.width }).toEqual({ x: before.x, width: before.width });
    expect((await sidebar.boundingBox())!.width).toBe(280);
    expect((await sidebar.locator(".tree-toggle").first().boundingBox())!.x).toBeGreaterThanOrEqual(28);
    const footer = (await sidebar.locator(".sidebar-footer").boundingBox())!;
    expect(footer.y + footer.height).toBeLessThanOrEqual(824);
    await page.screenshot({ path: test.info().outputPath(`mobile-safe-areas-${theme}.png`) });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect((await sidebar.boundingBox())!.width).toBe(72);
  }
});

test("sidebar Font Awesome stylesheet and glyphs load under the application CSP", async ({ page, isMobile }) => {
  const cdn = "https://static.itsmarian.dev/fonts/font-awesome-v7.2.0/";
  let releaseFonts!: () => void;
  const fontGate = new Promise<void>(resolve => { releaseFonts = resolve; });
  await page.route(cdn + "webfonts/**", async route => { await fontGate; await route.continue(); });
  const responses: { url: string; status: number }[] = [];
  page.on("response", response => {
    if (response.url().startsWith(cdn)) responses.push({ url: response.url(), status: response.status() });
  });
  await page.addInitScript(() => {
    (window as typeof window & { sidebarCspViolations: string[] }).sidebarCspViolations = [];
    document.addEventListener("securitypolicyviolation", event => {
      if (event.blockedURI.includes("static.itsmarian.dev")) (window as typeof window & { sidebarCspViolations: string[] }).sidebarCspViolations.push(event.violatedDirective);
    });
  });
  const state = await workspace(page, false, false, false, false);
  state.local.filters.push({ id: "saved", name: "Saved filter", criteria: {}, createdAt: "2026-10-03T12:00:00Z", updatedAt: "2026-10-03T12:00:00Z" });
  await initialSnapshot(page, state.graph, state.local);
  const response = await page.goto("/?view=today", { waitUntil: "domcontentloaded" });
  const policy = response!.headers()["content-security-policy"];
  expect(policy).toContain("style-src 'self' 'unsafe-inline' https://static.itsmarian.dev");
  expect(policy).toContain("font-src 'self' data: https://static.itsmarian.dev");
  await expect(page.locator('head link[rel="stylesheet"][href="' + cdn + 'css/all.min.css"]')).toHaveCount(1);
  const sidebar = page.locator(".desktop-sidebar");
  await expect(sidebar.getByRole("button", { name: /Today/ })).toHaveAttribute("aria-current", "page");
  for (const name of ["plus", "magnifying-glass", "chevron-right", "layer-group", "folder", "tag", "filter", "github", "envelope", "sliders"]) {
    await expect(sidebar.locator(`.fa-${name}`).first()).toBeVisible();
  }
  const toggle = sidebar.locator(".sidebar-brand-toggle");
  await expect(toggle).toHaveText("[<]");
  await expect(toggle.locator(".sidebar-icon, .fa-angles-left, .fa-angles-right")).toHaveCount(0);
  await expect(sidebar.locator(".fa-keyboard")).toBeVisible({ visible: !isMobile });
  await expect(sidebar.locator(".fa-github")).toHaveClass(/fa-brands/);
  const positions = () => sidebar.locator("button:visible").evaluateAll(elements => elements.map(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  }));
  const beforeFonts = await positions();
  releaseFonts();
  const glyphs = await sidebar.locator(".sidebar-icon:visible").evaluateAll(async elements => {
    await document.fonts.ready;
    return elements.map(element => {
      const style = getComputedStyle(element), pseudo = getComputedStyle(element, "::before");
      const glyph = pseudo.content.replace(/^['"]|['"]$/g, "");
      return { hidden: element.getAttribute("aria-hidden"), family: style.fontFamily, glyph, loaded: document.fonts.check(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, glyph), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height };
    });
  });
  for (const icon of glyphs) {
    expect(icon.hidden).toBe("true");
    expect(icon.family).toMatch(/Font Awesome 7/);
    expect(icon.glyph).not.toMatch(/^(?:none|normal|)$/);
    expect(icon.loaded).toBe(true);
    expect(icon.width).toBeGreaterThan(0);
    expect(icon.height).toBeGreaterThan(0);
  }
  expect(await positions()).toEqual(beforeFonts);
  for (const asset of ["css/all.min.css", "webfonts/fa-solid-900.woff2", "webfonts/fa-brands-400.woff2"]) {
    expect(responses.find(response => response.url === cdn + asset)?.status).toBe(200);
  }
  expect(await page.evaluate(() => (window as typeof window & { sidebarCspViolations: string[] }).sidebarCspViolations)).toEqual([]);
  // Non-sidebar controls retain Lucide rendering.
  await expect(page.locator(".workspace svg:visible").first()).toBeVisible();
  await expectGrid(page);
  await page.screenshot({ path: test.info().outputPath("font-awesome-expanded.png") });
  await sidebar.locator(".nav-scroll").evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.screenshot({ path: test.info().outputPath("font-awesome-external-footer.png") });
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(toggle).toHaveText("[>]");
  await expect(toggle.locator(".sidebar-icon, .fa-angles-left, .fa-angles-right")).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "Today", exact: true })).toHaveAttribute("aria-current", "page");
  await expectGrid(page);
  await page.screenshot({ path: test.info().outputPath("font-awesome-compact.png") });
});
