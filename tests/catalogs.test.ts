import { describe, expect, it, vi } from "vitest";
import { catalogUrls, loadCatalogs, CATALOG_MAX_BYTES } from "@/lib/server/catalogs";
import { dateCatalogSchema, languageCatalogSchema, selectLanguage } from "@/lib/catalogs";
import { createTranslator } from "@/lib/translation";
import english from "../public/locales/en/language.json";
import german from "../public/locales/de/language.json";
import englishDates from "../public/locales/en/date-phrases.json";
import germanDates from "../public/locales/de/date-phrases.json";

const language = (lang = "de", strings = { "common.undo": "Rückgängig" }) => ({ schemaVersion: 1, lang, name: "German", locName: "Deutsch", strings });
const dates = (lang = "de") => ({ schemaVersion: 1, lang, name: "German", locName: "Deutsch", phrases: { relativeDays: { today: ["heute"] } } });
const fetcher = (values: Record<string, unknown>) => vi.fn(async (url: string | URL | Request) => {
  if (!(String(url) in values)) throw new Error("unavailable https://private.example/?secret=secret");
  return Response.json(values[String(url)]);
}) as unknown as typeof fetch;

describe("validated central catalogs", () => {
  it("ships matching public English/German catalogs with complete keys and intact placeholders", () => {
    for (const [ui, date] of [[english, englishDates], [german, germanDates]] as const) {
      const validated = languageCatalogSchema.parse(ui);
      expect(dateCatalogSchema.parse(date).lang).toBe(validated.lang);
      expect(new TextEncoder().encode(JSON.stringify(ui)).byteLength).toBeLessThanOrEqual(CATALOG_MAX_BYTES);
      expect(Object.keys(ui.strings).sort()).toEqual(Object.keys(english.strings).sort());
      for (const [key, translated] of Object.entries(ui.strings)) {
        const original = english.strings[key as keyof typeof english.strings];
        const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
        expect(placeholders(translated), key).toEqual(placeholders(original));
      }
    }
    const { t, text } = createTranslator(languageCatalogSchema.parse(german));
    expect(t("common.undo")).toBe("Rückgängig");
    expect(t("completion.completed")).toBe("Aufgabe erledigt");
    expect(t("ui.task_title")).toBe("Aufgabentitel");
    expect(text("Settings")).toBe("Einstellungen");
    expect(german.locName).toBe("Deutsch");
  });
  it("splits, trims and deduplicates URL lists, preserving percent-encoded commas", () => {
    expect(catalogUrls(" https://a/language.json , ,https://b/a%2Cb.json,https://a/language.json ")).toEqual(["https://a/language.json", "https://b/a%2Cb.json"]);
  });
  it("normalizes BCP 47 tags and accepts the original unversioned v1 shape", () => {
    expect(languageCatalogSchema.parse({ ...language("DE-de"), schemaVersion: undefined }).lang).toBe("de-DE");
    expect(dateCatalogSchema.parse(dates()).phrases.relativeDays.today).toEqual(["heute"]);
    for (const patch of [{ lang: "not a tag" }, { strings: { bad: 2 } }, { schemaVersion: 2 }, { locName: "" }]) expect(languageCatalogSchema.safeParse({ ...language(), ...patch }).success).toBe(false);
    expect(dateCatalogSchema.safeParse({ ...dates(), phrases: { today: /arbitrary/ } }).success).toBe(false);
  });
  it("matches metadata rather than URL order; first valid duplicate wins", async () => {
    const result = await loadCatalogs("https://a/de, https://a/en, https://a/dup", "https://a/en-dates,https://a/de-dates,https://a/fr", fetcher({
      "https://a/de": language(), "https://a/en": language("en"), "https://a/dup": language("DE"), "https://a/en-dates": dates("en"), "https://a/de-dates": dates("de"), "https://a/fr": dates("fr"),
    }));
    expect(result.languages.map(value => value.lang)).toEqual(["de", "en"]);
    expect(result.dates.map(value => value.lang)).toEqual(["en", "de"]);
    expect(result.diagnostics.join(" ")).toMatch(/duplicate language de/);
    expect(result.diagnostics.join(" ")).toMatch(/no matching language catalog/);
  });
  it("keeps startup usable for missing, malformed, unsupported and unavailable catalogs without leaking URLs", async () => {
    const result = await loadCatalogs("file:///secret,https://a/unavailable,https://a/invalid", "https://a/dates", fetcher({ "https://a/invalid": { ...language(), schemaVersion: 9 }, "https://a/dates": dates() }));
    expect(result.languages).toEqual([]); expect(result.dates).toEqual([]);
    expect(result.diagnostics.join(" ")).not.toMatch(/https|secret|private/);
    expect(await loadCatalogs()).toEqual({ languages: [], dates: [], diagnostics: [] });
  });
  it("rejects oversized streams and declarations and disallows redirects and credentials", async () => {
    const oversized = vi.fn(async () => new Response(new Uint8Array(CATALOG_MAX_BYTES + 1))) as unknown as typeof fetch;
    expect((await loadCatalogs("https://a/large", "", oversized)).languages).toEqual([]);
    const mock = vi.fn(async (_url, options) => { expect(options.redirect).toBe("error"); expect(options.signal).toBeInstanceOf(AbortSignal); return new Response("{}", { headers: { "content-length": String(CATALOG_MAX_BYTES + 1) } }); }) as unknown as typeof fetch;
    expect((await loadCatalogs("https://user:pass@a/secret,https://a/large", "", mock)).languages).toEqual([]);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("aborts timed out requests", async () => {
    vi.useFakeTimers();
    try {
      const stalled = vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("timeout"))))) as unknown as typeof fetch;
      const pending = loadCatalogs("https://a/stall", "", stalled);
      await vi.advanceTimersByTimeAsync(2600);
      expect((await pending).languages).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
  it("selects saved, exact browser, base browser, English and built-in fallback safely", () => {
    const catalogs = [languageCatalogSchema.parse(language()), languageCatalogSchema.parse(language("en-GB"))];
    expect(selectLanguage(catalogs, "DE", ["en"])).toBe("de");
    expect(selectLanguage(catalogs, undefined, ["fr", "de-AT"])).toBe("de");
    expect(selectLanguage(catalogs, "fr", ["de"])).toBe("en-GB");
    expect(selectLanguage(catalogs, undefined, ["en-US"])).toBe("en-GB");
    expect(selectLanguage([], "de", ["de"])).toBe("en");
  });
  it("derives locale week starts and rejects conflicting semantic aliases", () => {
    expect(dateCatalogSchema.parse(dates("de-DE")).phrases.weekStart).toBe(1);
    expect(dateCatalogSchema.parse(dates("en-US")).phrases.weekStart).toBe(0);
    expect(dateCatalogSchema.safeParse({ ...dates(), phrases: { relativeDays: { today: ["same"], tomorrow: ["SAME"] } } }).success).toBe(false);
  });
  it("falls back per missing or invalid translation key and preserves interpolation data", () => {
    const translator = createTranslator(languageCatalogSchema.parse(language()));
    expect(translator.t("common.undo")).toBe("Rückgängig");
    expect(translator.t("completion.completed")).toBe("Task completed");
    expect(translator.text("Undo")).toBe("Rückgängig");
    expect(translator.text("An unknown service error")).toBe("An unknown service error");
    expect(createTranslator(languageCatalogSchema.parse(language("de", { "common.undo": "{invented}" }))).t("common.undo")).toBe("Undo");
  });
});
