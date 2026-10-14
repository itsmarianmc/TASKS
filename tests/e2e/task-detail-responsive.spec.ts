import { expect, test } from "@playwright/test";
import { workspace } from "./workspace.fixture";
import { initialSnapshot } from "./startup.fixture";

test("maximum-length task titles wrap in the drawer without horizontal scrolling", async ({ page }) => {
  const state = await workspace(page, false, false, false, false);
  const title = "UnbrokenTask".repeat(166);
  state.graph.tasks.find(task => task.id === "now")!.title = title;
  await page.setViewportSize({ width: 320, height: 844 });
  await initialSnapshot(page, state.graph, state.local, "today");
  await page.goto("/?view=today");
  await expect(page.locator("h1")).toContainText("Today");
  await page.locator('.task-row[data-task-id="now"] .task-content').click();

  const drawer = page.locator(".inspector-dialog.task-drawer");
  await expect(drawer).toHaveAttribute("data-state", "open");
  await expect(drawer.locator(".dialog-heading h2")).toHaveText(title);
  await page.waitForTimeout(260);

  for (const width of [320, 375, 390, 1280]) {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
    const layout = await page.evaluate(() => {
      const drawer = document.querySelector<HTMLElement>(".task-drawer")!;
      const heading = drawer.querySelector<HTMLElement>(".dialog-heading")!;
      const title = heading.querySelector<HTMLElement>("h2")!;
      const close = heading.querySelector<HTMLElement>("button")!;
      const content = drawer.querySelector<HTMLElement>(".inspector-content")!;
      const rect = (element: HTMLElement) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      };
      return {
        viewport: { width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, bodyWidth: document.body.clientWidth, bodyScrollWidth: document.body.scrollWidth },
        drawer: { ...rect(drawer), width: drawer.clientWidth, scrollWidth: drawer.scrollWidth, scrollHeight: drawer.scrollHeight, clientHeight: drawer.clientHeight },
        heading: rect(heading),
        title: rect(title), close: rect(close), content: { ...rect(content), width: content.clientWidth, scrollWidth: content.scrollWidth },
      };
    });

    expect(layout.viewport.scrollWidth, `document at ${width}px`).toBe(layout.viewport.width);
    expect(layout.viewport.bodyScrollWidth, `body at ${width}px`).toBeLessThanOrEqual(layout.viewport.bodyWidth);
    expect(layout.drawer.left).toBeGreaterThanOrEqual(0);
    expect(layout.drawer.right).toBeLessThanOrEqual(layout.viewport.width);
    expect(layout.drawer.scrollWidth, `drawer at ${width}px`).toBe(layout.drawer.width);
    expect(layout.drawer.scrollHeight, `vertical detail scroll at ${width}px`).toBeGreaterThan(layout.drawer.clientHeight);
    expect(layout.title.left).toBeGreaterThanOrEqual(layout.heading.left);
    expect(layout.title.right).toBeLessThanOrEqual(layout.close.left);
    expect(layout.close.right).toBeLessThanOrEqual(layout.drawer.right - 16);
    expect(layout.content.scrollWidth).toBe(layout.content.width);

    if (width === 320) await page.screenshot({ path: test.info().outputPath("task-detail-320.png") });
  }

  await page.setViewportSize({ width: 320, height: 844 });
  const titleField = drawer.getByLabel("Task title", { exact: true });
  await titleField.scrollIntoViewIfNeeded();
  await expect(titleField).toBeInViewport();
  expect(await drawer.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const actions = drawer.locator(".inspector-actions");
  await actions.scrollIntoViewIfNeeded();
  await expect(actions).toBeInViewport();
  await expect(drawer.getByRole("button", { name: "Trash task", exact: true })).toBeVisible();
});
