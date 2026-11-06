import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { workspace, navigate } from "./workspace.fixture";
import { initialSnapshot } from "./startup.fixture";

test("startup gates Notion, GitHub, Contact and preparation in displayed order, including failed sources", async ({ page }) => {
  const state = await workspace(page, true, true, false, false);
  await initialSnapshot(page, state.graph, state.local, "settings");
  const started: string[] = [];
  const releases = new Map<string, () => void>();
  for (const source of ["graph", "github", "contact"]) {
    const held = new Promise<void>(resolve => releases.set(source, resolve));
    await page.route(url => url.pathname === `/api/${source}`, async route => {
      started.push(source); await held;
      if (source === "github") return route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "Source unavailable" } } });
      return route.fallback();
    });
  }
  await page.goto("/");
  await expect.poll(() => started).toEqual(["graph"]);
  await expect(page.locator('[data-step="github"]')).toHaveClass(/pending/);
  await expect(page.locator('[data-step="contact"]')).toHaveClass(/pending/);
  await expect(page.locator('[data-step="prepare"]')).toHaveClass(/pending/);
  releases.get("graph")!();
  await expect.poll(() => started.includes("github")).toBe(true);
  expect(started).not.toContain("contact");
  await expect(page.locator('[data-step="github"]')).toHaveClass(/active/);
  releases.get("github")!();
  await expect.poll(() => started.includes("contact")).toBe(true);
  await expect(page.locator('[data-step="github"]')).toHaveClass(/warning/);
  await expect(page.locator('[data-step="prepare"]')).toHaveClass(/pending/);
  releases.get("contact")!();
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await expect(page.locator("h1")).toHaveText("Settings");
});

test("English first use, external grouping, duplicate selection, source fallback and reload persistence", async ({ page }) => {
  const state = await workspace(page, false, false, false, false);
  delete state.local.preferences.language;
  const en = JSON.parse(readFileSync(new URL("../../public/locales/en/language.json", import.meta.url), "utf8"));
  const de = JSON.parse(readFileSync(new URL("../../public/locales/de/language.json", import.meta.url), "utf8"));
  const enDates = JSON.parse(readFileSync(new URL("../../public/locales/en/date-phrases.json", import.meta.url), "utf8"));
  const deDates = JSON.parse(readFileSync(new URL("../../public/locales/de/date-phrases.json", import.meta.url), "utf8"));
  const id = `external:${"a".repeat(20)}:de`;
  const titleKey = Object.keys(en.strings).find(key => en.strings[key] === "Settings")!;
  const external = { ...de, id, origin: "external", sourceOrder: 1, strings: { ...de.strings, [titleKey]: "Externe Einstellungen" } };
  let available = true;
  await page.route("**/api/config", route => route.fulfill({ json: { timezone: "Europe/Berlin", maxUploadBytes: 20971520, appName: "TÆSKS", preferredLanguages: ["de-DE"], catalogs: {
    languages: [...(available ? [external] : []), { ...en, id: "repo:en", origin: "repository" }, { ...de, id: "repo:de", origin: "repository" }],
    dates: [...(available ? [{ ...deDates, id }] : []), { ...enDates, id: "repo:en" }, { ...deDates, id: "repo:de" }], diagnostics: []
  } } }));
  await page.goto("/?view=today");
  await expect(page.locator("h1")).toHaveText(/Today/);
  await expect(page.locator(".boot-screen")).toHaveCount(0);
  await navigate(page, "Settings & diagnostics");
  const select = page.locator("#language");
  await expect(select).toHaveValue("repo:en");
  await expect(select.locator("optgroup").first()).toHaveAttribute("label", "[!] External translations");
  await expect(select.locator("option").first()).toHaveText("[!] Deutsch (1)");
  await expect(select.locator("optgroup").nth(1)).toHaveAttribute("label", /Repository translations/);
  await expect(page.locator("#language-origin")).toContainText("have not been verified");
  await select.selectOption(id);
  await expect.poll(() => state.local.preferences.language).toBe(id);
  await expect(page.locator("h1")).toHaveText("Externe Einstellungen");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Externe Einstellungen");
  await expect(page.locator("#language")).toHaveValue(id);
  available = false;
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Settings");
  await expect(page.locator("#language")).toHaveValue("repo:en");
  expect(state.local.preferences.language).toBe(id);
  available = true;
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Externe Einstellungen");
});
