import { describe, expect, it, vi } from "vitest";
import { catalogFolder, catalogUrls, createCatalogManager, externalSourceId, loadCatalogs, CATALOG_MAX_BYTES, CATALOG_REFRESH_MS, REPOSITORY_API } from "@/lib/server/catalogs";
import { catalogId, compatibleCatalogPair, dateCatalogSchema, languageCatalogSchema, selectLanguage } from "@/lib/catalogs";
import { preferencesPatchSchema } from "@/lib/schemas";
import { createTranslator } from "@/lib/translation";
import english from "../public/locales/en/language.json";
import german from "../public/locales/de/language.json";
import englishDates from "../public/locales/en/date-phrases.json";
import germanDates from "../public/locales/de/date-phrases.json";

const ui = (lang = "de") => ({ ...german, lang });
const dates = (lang = "de") => ({ ...germanDates, lang });
function fixture(values: Record<string, unknown | Response>) {
  return vi.fn(async (url: string | URL | Request) => {
    if (!(String(url) in values)) throw new Error("https://private.example/?secret=secret");
    const value = values[String(url)]; return value instanceof Response ? value.clone() : Response.json(value);
  }) as unknown as typeof fetch;
}
const folderFixture = (folder = "https://a/de/", lang = "de") => ({ [`${folder}language.json`]: ui(lang), [`${folder}date-phrases.json`]: dates(lang) });
const sha = "a".repeat(40), nextSha = "b".repeat(40);
function repositoryFixture(langs: string[], revision = sha) {
  return { [`${REPOSITORY_API}/commits/main`]: { sha: revision }, [`${REPOSITORY_API}/contents/public/locales?ref=${revision}`]: langs.map(name => ({ name, type: "dir" })), ...Object.assign({}, ...langs.map(lang => folderFixture(`https://raw.githubusercontent.com/itsmarianmc/T-SKS/${revision}/public/locales/${lang}/`, lang))) };
}

describe("translation contract", () => {
  it("ships complete English/German pairs with matching placeholders and keeps user content untouched", () => {
    for (const [language, date] of [[english, englishDates], [german, germanDates]]) {
      expect(compatibleCatalogPair(language, date).language.lang).toBe(language.lang);
      expect(new TextEncoder().encode(JSON.stringify(language)).length).toBeLessThan(CATALOG_MAX_BYTES);
    }
    const { t } = createTranslator(languageCatalogSchema.parse(german));
    expect(t("common.undo")).toBe("Rückgängig");
    expect(t("ui.task_title")).toBe("Aufgabentitel");
    const key = Object.keys(english.strings).find(key => english.strings[key as keyof typeof english.strings].includes("{p0}"))!;
    expect(createTranslator().text("Mein privates Projekt")).toBe("Mein privates Projekt");
    expect(() => compatibleCatalogPair({ ...english, strings: { ...english.strings, [key]: "Missing parameter" } }, englishDates)).toThrow();
    expect(() => compatibleCatalogPair({ ...english, strings: { "common.undo": "Undo" } }, englishDates)).toThrow();
    expect(() => compatibleCatalogPair({ ...english, schemaVersion: 9 }, englishDates)).toThrow();
  });
  it("validates metadata, language tags, limits and conflicting aliases", () => {
    expect(languageCatalogSchema.parse({ ...ui("DE-de"), schemaVersion: undefined }).lang).toBe("de-DE");
    for (const patch of [{ lang: "not a tag" }, { strings: { bad: 2 } }, { schemaVersion: 2 }, { locName: "" }]) expect(languageCatalogSchema.safeParse({ ...ui(), ...patch }).success).toBe(false);
    expect(dateCatalogSchema.safeParse({ ...dates(), phrases: { relativeDays: { today: ["same"], tomorrow: ["same"] } } }).success).toBe(false);
    expect(dateCatalogSchema.parse({ ...dates("en-US"), phrases: {} }).phrases.weekStart).toBe(0);
  });
  it("defaults to repository English, migrates legacy codes and never substitutes another source", () => {
    const languages = createCatalogManager().snapshot().languages;
    const external = { ...languageCatalogSchema.parse(ui()), id: `external:${"a".repeat(20)}:de`, origin: "external" as const };
    const available = [external, ...languages];
    expect(selectLanguage(available, undefined, ["de-DE"])).toBe("repo:en");
    expect(selectLanguage(available, "DE", ["en"])).toBe("repo:de");
    expect(selectLanguage(available, external.id)).toBe(external.id);
    expect(selectLanguage(languages, external.id)).toBe("repo:en");
    expect(selectLanguage(available, "repo:fr")).toBe("repo:en");
    expect(preferencesPatchSchema.parse({ language: external.id }).language).toBe(external.id);
    expect(preferencesPatchSchema.safeParse({ language: "external:secret:de" }).success).toBe(false);
  });
});
describe("external folder pairs", () => {
  it("joins one/multiple folders with slashes, whitespace and encoded commas; keeps duplicate codes separate", async () => {
    expect(catalogUrls(" https://a/de , ,https://a/a%2Cb/,https://a/de ")).toEqual(["https://a/de", "https://a/a%2Cb/"]);
    expect(catalogFolder("https://a/de///").href).toBe("https://a/de/");
    const fetcher = fixture({ ...folderFixture(), ...folderFixture("https://a/a%2Cb/") });
    const result = await loadCatalogs(" https://a/de, https://a/a%2Cb/ ", fetcher);
    expect(result.languages).toHaveLength(2);
    expect(result.languages[0].id).not.toBe(result.languages[1].id);
    expect(result.languages.map(catalogId)).toEqual(result.dates.map(catalogId));
    expect(externalSourceId(catalogFolder("https://a/de/"))).toBe(externalSourceId(catalogFolder("https://a/de")));
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it.each(["file:///secret", "https://user:pass@a/de", "https://a/de?token=secret", "https://a/de#secret", "https://a/de/language.json"])("rejects unsafe or ambiguous folder %s before fetch", async value => {
    const fetcher = fixture({}); const result = await loadCatalogs(value, fetcher);
    expect(fetcher).not.toHaveBeenCalled(); expect(result.languages).toEqual([]);
    expect(result.diagnostics.join(" ")).not.toMatch(/https|secret|private|user:pass/);
  });
  it.each(["missing", "mismatch", "malformed", "incomplete", "unsupported"])("rejects the entire %s pair", async kind => {
    const values: Record<string, unknown> = folderFixture();
    if (kind === "missing") delete values["https://a/de/date-phrases.json"];
    if (kind === "mismatch") values["https://a/de/date-phrases.json"] = dates("fr");
    if (kind === "malformed") values["https://a/de/date-phrases.json"] = new Response("{oops");
    if (kind === "incomplete") values["https://a/de/language.json"] = { ...ui(), strings: {} };
    if (kind === "unsupported") values["https://a/de/language.json"] = { ...ui(), schemaVersion: 2 };
    const result = await loadCatalogs("https://a/de", fixture(values));
    expect(result.languages).toEqual([]); expect(result.dates).toEqual([]);
    expect(result.diagnostics.join(" ")).not.toMatch(/https|secret|private|oops/);
  });
  it("bounds sizes, folder count, redirects, credentials and concurrency", async () => {
    const oversized = fixture({ "https://a/de/language.json": new Response(new Uint8Array(CATALOG_MAX_BYTES + 1)) });
    expect((await loadCatalogs("https://a/de", oversized)).languages).toEqual([]);
    const declared = fixture({ "https://a/de/language.json": new Response("{}", { headers: { "content-length": String(CATALOG_MAX_BYTES + 1) } }) });
    expect((await loadCatalogs("https://a/de", declared)).languages).toEqual([]);
    let active = 0, peak = 0;
    const fetcher = vi.fn(async (_url, options) => {
      expect(options.redirect).toBe("error"); expect(options.credentials).toBe("omit");
      active++; peak = Math.max(peak, active); await Promise.resolve(); active--;
      throw new Error("private");
    }) as unknown as typeof fetch;
    const result = await loadCatalogs(Array.from({ length: 20 }, (_, n) => `https://a/${n}`).join(","), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(16); expect(peak).toBeLessThanOrEqual(4);
    expect(result.diagnostics.join(" ")).toContain("first 16");
  });
  it("times out even if a transport ignores abort", async () => {
    vi.useFakeTimers();
    try {
      const pending = loadCatalogs("https://a/de", vi.fn(() => new Promise(() => {})) as unknown as typeof fetch);
      await vi.advanceTimersByTimeAsync(2600);
      expect((await pending).diagnostics.join(" ")).toContain("timed out");
    } finally { vi.useRealTimers(); }
  });
});
describe("bundles and running-process repository discovery", () => {
  it.each([403, 429, 503])("keeps offline English/German when GitHub returns %s without making startup wait", async status => {
    const manager = createCatalogManager({ fetcher: fixture({ [`REPOSITORY_API`]: null, [`${REPOSITORY_API}/commits/main`]: new Response("secret", { status }) }) });
    expect(manager.snapshot().languages.map(catalogId)).toEqual(["repo:de", "repo:en"]);
    await manager.refresh();
    expect(manager.snapshot().languages.map(catalogId)).toEqual(["repo:de", "repo:en"]);
    expect(manager.snapshot().diagnostics.join(" ")).not.toMatch(/https|secret/);
  });
  it("discovers a new folder, refreshes in the same manager and retains last-good data on failure", async () => {
    let time = 1, values = repositoryFixture(["en", "de", "fr"]);
    const fetcher = vi.fn((url, init) => fixture(values)(url, init)) as unknown as typeof fetch;
    const manager = createCatalogManager({ fetcher, now: () => time });
    await Promise.all([manager.refresh(), manager.refresh()]);
    expect(manager.index().languages).toContain("fr");
    expect(manager.snapshot().languages.map(catalogId)).toContain("repo:fr");
    const count = vi.mocked(fetcher).mock.calls.length;
    await manager.refresh(); expect(fetcher).toHaveBeenCalledTimes(count);
    time += CATALOG_REFRESH_MS;
    values = repositoryFixture(["en", "de", "fr", "es"], nextSha);
    await manager.refresh(); expect(manager.snapshot().languages.map(catalogId)).toContain("repo:es");
    time += CATALOG_REFRESH_MS; values = {} as typeof values;
    await manager.refresh(); expect(manager.snapshot().languages.map(catalogId)).toContain("repo:es");
  });
  it("rejects invalid listings, incompatible files, folder/tag mismatches and missing pairs", async () => {
    for (const invalid of ["bad-listing", "incompatible", "wrong-tag", "missing"]) {
      const values: Record<string, unknown> = repositoryFixture(["fr"]);
      const raw = `https://raw.githubusercontent.com/itsmarianmc/T-SKS/${sha}/public/locales/fr/`;
      if (invalid === "bad-listing") values[`${REPOSITORY_API}/contents/public/locales?ref=${sha}`] = {};
      if (invalid === "incompatible") values[`${raw}language.json`] = { ...ui("fr"), strings: {} };
      if (invalid === "wrong-tag") values[`${raw}language.json`] = ui("de");
      if (invalid === "missing") delete values[`${raw}date-phrases.json`];
      const manager = createCatalogManager({ fetcher: fixture(values) }); await manager.refresh();
      expect(manager.snapshot().languages.map(catalogId)).not.toContain("repo:fr");
      expect(manager.snapshot().languages.map(catalogId)).toContain("repo:en");
    }
  });
  it("orders external first, keeps repository duplicates and preserves exact source through a temporary outage", async () => {
    let time = 1, fail = false;
    const values = { ...repositoryFixture(["en", "de"]), ...folderFixture() };
    const manager = createCatalogManager({ folders: "https://a/de", now: () => time, fetcher: vi.fn((url, init) => fail ? Promise.reject(new Error("secret")) : fixture(values)(url, init)) as unknown as typeof fetch });
    await manager.refresh(); const first = manager.snapshot();
    expect(first.languages[0].origin).toBe("external");
    expect(first.languages.filter(value => value.lang === "de")).toHaveLength(2);
    const saved = first.languages[0].id!; fail = true; time += CATALOG_REFRESH_MS;
    await manager.refresh(); expect(selectLanguage(manager.snapshot().languages, saved)).toBe(saved);
    expect(manager.snapshot().dates.find(value => catalogId(value) === saved)?.origin).toBe("external");
  });
});
