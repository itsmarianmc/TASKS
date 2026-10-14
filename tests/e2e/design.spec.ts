import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { workspace, navigate, capture } from "./workspace.fixture";

async function religionWorkspace(page: Page) {
  const state = await workspace(page, true, true);
  state.graph.areas = ["books", "presentations"].map((id, index) => ({ id, name: ["Bücher", "Präsentationen"][index], type: "School", projectIds: ["religion"], url: "" }));
  state.graph.projects = [{ ...state.graph.projects[0], id: "religion", name: "Religion", areaIds: ["books", "presentations"] }];
  state.graph.tasks = [
    { ...state.graph.tasks[0], id: "book", title: "Read religion chapter", areaId: "books", projectId: "religion" },
    { ...state.graph.tasks[1], id: "slides", title: "Prepare religion slides", areaId: "presentations", projectId: "religion" },
    { ...state.graph.tasks[1], id: "sources", title: "Collect presentation sources", areaId: "presentations", projectId: "religion" },
    { ...state.graph.tasks[4], id: "book-later", title: "Read next volume someday", areaId: "books", projectId: "religion" },
  ];
  state.local.metadata = [{ ...state.local.metadata[0], taskId: "book-later" }];
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(page.locator(".task-title")).toContainText(["Read religion chapter", "Collect presentation sources", "Prepare religion slides"]);
  return state;
}

test("Religion remains distinct across areas, counts, capture, direct URLs and browser history", async ({ page, isMobile }) => {
  const state = await religionWorkspace(page);
  await navigate(page, "Bücher / Religion");
  await expect(page).toHaveURL(/view=project&project=religion&area=books/);
  await expect(page.locator(".desktop-sidebar .nav-row.active")).toHaveCount(1);
  await expect(page.locator(".desktop-sidebar .context-active")).toContainText("Bücher");
  await expect(page.locator(".desktop-sidebar .context-active .nav-row.indented .nav-count")).toHaveText("1");
  await expect(page.locator(".view-project .task-title")).toHaveText(["Read religion chapter", "Read next volume someday"]);
  await expect(page.locator(".header-current")).toContainText("Religion");
  if (!isMobile) await expect(page.locator(".breadcrumb-button")).toContainText("Bücher");
  await navigate(page, "Präsentationen / Religion");
  await expect(page.locator(".view-project .task-title")).toHaveText(["Collect presentation sources", "Prepare religion slides"]);
  await expect(page.locator(".view-project")).not.toContainText("Read religion chapter");
  await expect(page.locator(".desktop-sidebar .nav-row.active")).toHaveCount(1);
  await expect(page.locator(".desktop-sidebar .context-active .nav-row.indented .nav-count")).toHaveText("2");
  await capture(page, "Prepare presentation until Friday");
  await expect(page.locator(".capture-preview")).toContainText("@Präsentationen");
  await expect(page.locator(".capture-preview")).toContainText("$Religion");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.locator(".creation-result")).toContainText("Created in Notion");
  expect(state.creates[0].task).toMatchObject({ areaId: "presentations", projectId: "religion" });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.goBack();
  await expect(page).toHaveURL(/area=books/);
  await expect(page.locator(".view-project .task-title")).not.toContainText(["Prepare religion slides"]);
  await page.goForward(); await expect(page).toHaveURL(/area=presentations/);
  await page.reload();
  await expect(page.locator(".desktop-sidebar .context-active")).toContainText("Präsentationen");
  await expect(page.locator(".view-project .task-title")).not.toContainText(["Read religion chapter"]);
});

test("legacy project URLs ask for area context and mobile lists use the full viewport", async ({ page, isMobile }) => {
  await religionWorkspace(page);
  await page.goto("/?view=project%3Areligion");
  await expect(page.locator(".view-project")).toContainText("Choose an area");
  await expect(page.locator(".view-project .task-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Präsentationen / Religion →", exact: true }).click();
  await expect(page).toHaveURL(/area=presentations/);
  if (isMobile) {
    await navigate(page, "Today");
    await page.locator(".mobile-back").click();
    await expect(page.locator(".mobile-list-root")).toBeVisible();
    const width = await page.locator(".mobile-list-root").evaluate(el => el.getBoundingClientRect().width);
    expect(width).toBe(page.viewportSize()!.width);
    await page.locator(".mobile-list-root .nav-row").filter({ hasText: "Today" }).click();
    await expect(page.locator(".mobile-list-root")).toHaveCount(0);
  }
});

test("responsive screenshot QA covers all target sizes, source views and both themes", async ({ page, isMobile }) => {
  test.setTimeout(180000);
  await workspace(page, true, true);
  const directory = "test-results/design-screenshots";
  await mkdir(directory, { recursive: true });
  const sizes = isMobile ? [[390, 844], [430, 932]] : [[768, 1024], [1366, 768], [1440, 900], [1920, 1080], [2560, 1440]];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await navigate(page, "Today");
    const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport);
    await page.screenshot({ path: `${directory}/dark-today-${width}.png`, fullPage: true });
    if (width > 760) {
      const layout = await page.locator("main").evaluate(el => ({ left: el.getBoundingClientRect().left, padding: parseFloat(getComputedStyle(el).paddingLeft), font: parseFloat(getComputedStyle(document.querySelector(".task-title")!).fontSize) }));
      expect(layout.left).toBeLessThan(290); expect(layout.padding).toBeLessThanOrEqual(56); expect(layout.font).toBeGreaterThanOrEqual(14);
    }
  }
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1920, height: 1080 });
  const prefix = isMobile ? "mobile" : "desktop";
  for (const [name, command] of [["inbox", "Inbox"], ["overview", "Overview"], ["area", "Homework"], ["project", "Homework / English"], ["github", "GitHub"], ["contact", "Contact"]]) {
    await navigate(page, command);
    if (name === "github") await page.getByRole("combobox", { name: "GitHub repository" }).selectOption("owner/repo");
    if (name === "contact") await page.getByRole("button", { name: /Contact Visitor Tomorrow/ }).click();
    await page.screenshot({ path: `${directory}/${prefix}-dark-${name}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await navigate(page, "Homework / English"); await capture(page, "Prepare presentation until Friday [school]");
  await page.screenshot({ path: `${directory}/${prefix}-dark-quick-add.png` }); await page.keyboard.press("Escape");
  if (isMobile) {
    await navigate(page, "Today"); await page.locator(".mobile-back").click();
    await page.screenshot({ path: `${directory}/mobile-dark-lists.png` });
    await page.locator(".mobile-list-close").click();
  }
  await navigate(page, "Toggle theme");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  for (const [name, command] of [["today", "Today"], ["project", "Homework / English"], ["contact", "Contact"]]) {
    await navigate(page, command); await page.screenshot({ path: `${directory}/${prefix}-light-${name}.png`, fullPage: true });
  }
  if (isMobile) {
    await navigate(page, "Today"); await page.locator(".mobile-back").click();
    await page.screenshot({ path: `${directory}/mobile-light-lists.png` });
  }
});
