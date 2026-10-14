import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

// Manual, read-only source QA. Only reversible workspace preferences are restored below.
const mode = process.env.QA_SCREENSHOT_MODE ?? "after";
const base = "http://localhost:2015";
const directory = "test-results/design-live";
await mkdir(directory, { recursive: true });
const original = await (await fetch(`${base}/api/local`)).json();
const browser = await chromium.launch({ channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: "block" });
const page = await context.newPage();
async function command(text) {
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: "Search", exact: true }).fill(text);
  await page.locator(".palette-result").first().click();
}
async function shot(name) {
  await page.mouse.move(1919, 0);
  await page.screenshot({ path: `${directory}/${mode}-${name}.png`, fullPage: false });
}
try {
  await page.goto(base);
  await expect(page.locator(".area-tree").filter({ hasText: "Präsentationen" })).toBeVisible({ timeout: 30000 });
  await command("Präsentationen"); await shot("desktop-area");
  await page.locator(".area-tree").filter({ hasText: "Präsentationen" }).getByRole("button", { name: /\$ Religion/ }).click();
  await expect(page.locator(".header-current")).toContainText("Religion");
  await shot("desktop-project");
  if (mode === "after") {
    for (const name of ["Inbox", "Overview", "Today", "GitHub", "Contact"]) {
      await command(name);
      await shot(`desktop-${name.toLowerCase()}`);
    }
    await command("Präsentationen / Religion");
    await page.locator(".header-add").click(); await shot("desktop-quick-add"); await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 390, height: 844 });
    await command("Today"); await shot("mobile-today");
    await page.locator(".mobile-back").click(); await shot("mobile-lists");
    await page.locator(".mobile-list-close").click();
    await command("Präsentationen / Religion"); await shot("mobile-project");
    await command("Toggle theme"); await shot("mobile-project-alternate-theme");
    await page.setViewportSize({ width: 1920, height: 1080 }); await shot("desktop-project-alternate-theme");
  }
  console.log(`Captured ${mode} live screenshots; no source items were changed.`);
} finally {
  const response = await fetch(`${base}/api/local`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ action: "setPreferences", patch: original.preferences }) });
  if (!response.ok) throw new Error("Original workspace preferences could not be restored");
  await browser.close();
}
