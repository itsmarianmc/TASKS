import en from "../../public/locales/en/date-phrases.json";
import de from "../../public/locales/de/date-phrases.json";
import { dateCatalogSchema, type DateCatalog } from "./catalogs";
import { addCalendarDays, isoCalendarDate } from "./calendar";

export const builtInDateCatalogs = [dateCatalogSchema.parse(en), dateCatalogSchema.parse(de)];
const normalize = (value: string) => value.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
type Meaning = { kind: "day"; offset: number } | { kind: "week"; weeks: number; weekday?: number; weekStart: number } | { kind: "weekday"; weekday: number; after: boolean; inclusive?: boolean };
function buildDatePhrases(catalog?: DateCatalog) {
  const meanings = new Map<string, Meaning>();
  for (const { phrases: p } of [...builtInDateCatalogs, ...(catalog ? [catalog] : [])]) {
    const add = (aliases: string[] | undefined, meaning: Meaning) => { for (const alias of aliases ?? []) meanings.set(normalize(alias), meaning); };
    for (const [key, offset] of Object.entries({ today: 0, tomorrow: 1, dayAfterTomorrow: 2, yesterday: -1, dayBeforeYesterday: -2 })) add(p.relativeDays[key as keyof typeof p.relativeDays], { kind: "day", offset });
    const weekStart = p.weekStart;
    add(p.nextWeek, { kind: "week", weeks: 1, weekStart }); add(p.weekAfterNext, { kind: "week", weeks: 2, weekStart });
    add(p.nextWeekend, { kind: "weekday", weekday: 6, after: false }); add(p.weekendAfterNext, { kind: "weekday", weekday: 6, after: true });
    Object.keys(p.weekdays).forEach(key => {
      const weekday = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(key);
      for (const day of p.weekdays[key as keyof typeof p.weekdays] ?? []) {
        add([day], { kind: "weekday", weekday, after: false, inclusive: true });
        for (const modifier of p.next) add([`${modifier} ${day}`], { kind: "weekday", weekday, after: false });
        for (const modifier of p.afterNext) add([`${modifier} ${day}`], { kind: "weekday", weekday, after: true });
        for (const modifier of p.nextWeek) add([`${day} ${modifier}`], { kind: "week", weeks: 1, weekday, weekStart });
        for (const modifier of p.weekAfterNext) add([`${day} ${modifier}`], { kind: "week", weeks: 2, weekday, weekStart });
      }
    });
  }
  const durationCatalogs = [...builtInDateCatalogs, ...(catalog ? [catalog] : [])];
  const durationPatterns = durationCatalogs.flatMap(({ phrases: { durations: d } }) => {
    if (!d.prefixes?.length) return [];
    return (["day", "week", "month", "year"] as const).flatMap(unit => !d[unit]?.length ? [] : [{ unit, numbers: Object.fromEntries(Object.entries(d.numbers ?? {}).map(([alias, count]) => [normalize(alias), count])), regex: new RegExp(`^(?:${d.prefixes!.map(escape).join("|")})\\s+(\\d+|${Object.keys(d.numbers ?? {}).map(escape).join("|") || "(?!)"})\\s+(?:${d[unit]!.map(escape).join("|")})$`, "iu") }]);
  });
  const source = [...meanings.keys()].sort((a, b) => b.length - a.length).map(escape).join("|");
  const durations = durationPatterns.map(item => item.regex.source.slice(1, -1).replace("(\\d+|", "(?:\\d+|")).join("|");
  return {
    source: `(?:${source}${durations ? `|${durations}` : ""})`,
    recognizes: (text: string) => meanings.has(normalize(text)) || durationPatterns.some(({ regex }) => regex.test(text)),
    resolve(text: string, reference: string, anchor = reference): string | null {
      const meaning = meanings.get(normalize(text));
      if (meaning) {
        if (meaning.kind === "day") return addCalendarDays(anchor, meaning.offset);
        const day = new Date(`${reference}T12:00:00Z`).getUTCDay();
        if (meaning.kind === "weekday") return addCalendarDays(reference, ((meaning.weekday - day + 7) % 7 || (meaning.inclusive ? 0 : 7)) + (meaning.after ? 7 : 0));
        return addCalendarDays(reference, -((day - meaning.weekStart + 7) % 7) + meaning.weeks * 7 + ((meaning.weekday ?? meaning.weekStart) - meaning.weekStart + 7) % 7);
      }
      for (const { unit, numbers, regex } of durationPatterns) {
        const match = regex.exec(text); if (!match) continue;
        const count = numbers[normalize(match[1])] ?? Number(match[1]);
        if (!Number.isInteger(count) || count < 1 || count > 365) return null;
        if (unit === "day" || unit === "week") return addCalendarDays(reference, count * (unit === "week" ? 7 : 1));
        const [year, month, day] = reference.split("-").map(Number);
        const totalMonths = year * 12 + month - 1 + count * (unit === "year" ? 12 : 1);
        return isoCalendarDate(Math.floor(totalMonths / 12), totalMonths % 12 + 1, day);
      }
      return null;
    },
  };
}


const compiled = new WeakMap<DateCatalog, ReturnType<typeof buildDatePhrases>>();
let builtIn: ReturnType<typeof buildDatePhrases> | undefined;
export function compileDatePhrases(catalog?: DateCatalog) {
  if (!catalog) return builtIn ??= buildDatePhrases();
  let value = compiled.get(catalog);
  if (!value) { value = buildDatePhrases(catalog); compiled.set(catalog, value); }
  return value;
}
