import { z } from "zod";

export function normalizeLanguage(value: string): string | null {
  try { return Intl.getCanonicalLocales(value.trim())[0] ?? null; } catch { return null; }
}
const metadata = {
  schemaVersion: z.literal(1).default(1),
  lang: z.string().max(80).refine(value => !!normalizeLanguage(value)).transform(value => normalizeLanguage(value)!),
  name: z.string().trim().min(1).max(100), locName: z.string().trim().min(1).max(100),
};
const aliases = z.array(z.string().trim().min(1).max(100)).max(80);
function localeWeekStart(lang: string) {
  const locale = new Intl.Locale(lang) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
  return ((locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay ?? 1) % 7;
}
export const languageCatalogSchema = z.object({ ...metadata, strings: z.record(z.string().regex(/^[\w.-]+$/).max(180), z.string().max(4000)).refine(value => Object.keys(value).length <= 3000) }).strict();
export const dateCatalogSchema = z.object({ ...metadata, phrases: z.object({
  weekStart: z.number().int().min(0).max(6).optional(),
  relativeDays: z.object({ today: aliases, tomorrow: aliases, dayAfterTomorrow: aliases, yesterday: aliases, dayBeforeYesterday: aliases }).partial().strict().default({}),
  nextWeek: aliases.default([]), weekAfterNext: aliases.default([]), nextWeekend: aliases.default([]), weekendAfterNext: aliases.default([]),
  weekdays: z.object({ sunday: aliases, monday: aliases, tuesday: aliases, wednesday: aliases, thursday: aliases, friday: aliases, saturday: aliases }).partial().strict().default({}),
  next: aliases.default([]), afterNext: aliases.default([]),
  durations: z.object({ prefixes: aliases, day: aliases, week: aliases, month: aliases, year: aliases, numbers: z.record(z.string().trim().min(1).max(40), z.number().int().min(1).max(365)) }).partial().strict().default({}),
}).strict() }).strict().superRefine((catalog, ctx) => {
  const meanings = new Map<string, string>(); let total = 0;
  const p = catalog.phrases;
  const groups = { ...p.relativeDays, ...p.weekdays, nextWeek: p.nextWeek, weekAfterNext: p.weekAfterNext, nextWeekend: p.nextWeekend, weekendAfterNext: p.weekendAfterNext };
  for (const [kind, values] of Object.entries(groups)) for (const alias of values ?? []) {
    total++;
    const normalized = alias.normalize("NFC").toLowerCase().replace(/\s+/g, " ");
    if (meanings.has(normalized) && meanings.get(normalized) !== kind) ctx.addIssue({ code: "custom", message: "An alias has conflicting date meanings." });
    meanings.set(normalized, kind);
  }
  total += p.next.length + p.afterNext.length + Object.values(p.durations).reduce((count, value) => count + (Array.isArray(value) ? value.length : Object.keys(value).length), 0);
  if (total > 400) ctx.addIssue({ code: "custom", message: "At most 400 aliases/numbers per date catalog." });
}).transform(catalog => ({ ...catalog, phrases: { ...catalog.phrases, weekStart: catalog.phrases.weekStart ?? localeWeekStart(catalog.lang) } }));
export type LanguageCatalog = z.infer<typeof languageCatalogSchema>;
export type DateCatalog = z.infer<typeof dateCatalogSchema>;
export interface Catalogs { languages: LanguageCatalog[]; dates: DateCatalog[]; diagnostics: string[] }
export function selectLanguage(languages: LanguageCatalog[], saved?: string, preferred: readonly string[] = []): string {
  const available = languages.map(value => value.lang);
  const exact = saved && normalizeLanguage(saved);
  if (exact && available.includes(exact)) return exact;
  // An unavailable saved choice deliberately falls back to English.
  if (!saved) for (const preference of preferred) {
    const canonical = normalizeLanguage(preference);
    if (!canonical) continue;
    const match = available.find(lang => lang === canonical) ?? available.find(lang => lang.split("-")[0] === canonical.split("-")[0]);
    if (match) return match;
  }
  return available.find(lang => lang === "en") ?? available.find(lang => lang.startsWith("en-")) ?? "en";
}
