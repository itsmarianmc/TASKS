import { en, de } from "chrono-node";
import { addCalendarDays, isoCalendarDate } from "./calendar";
import type { DateRange, ISODate } from "./types";

export interface Span { start: number; end: number }
export const maskSpans = (text: string, spans: Span[]) => {
  const chars = text.split("");
  for (const span of spans) for (let i = span.start; i < span.end; i++) chars[i] = " ";
  return chars.join("");
};
const month = "(?:jan(?:uary|uar)?|feb(?:ruary|ruar)?|mar(?:ch)?|märz|maerz|apr(?:il)?|may|mai|jun(?:e|i)?|jul(?:y|i)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|okt(?:ober)?|nov(?:ember)?|dec(?:ember)?|dez(?:ember)?)";
const weekday = "(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)";
const number = "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|ein(?:e|en)?|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn)";
const unit = "(?:days?|weeks?|months?|years?|tag(?:e|en)?|wochen?|monat(?:e|en)?|jahr(?:e|en)?)";
const afterNext = "(?:über|ueber)\\s*nächste[nrms]?|(?:über|ueber)\\s*naechste[nrms]?";
const germanRelative = `(?:${afterNext})\\s+(?:${weekday}|woche|wochenende)`;
const atom = `(?:${germanRelative}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[./]\\d{1,2}(?:[./]\\d{4}|\\.)?|\\d{1,2}(?:st|nd|rd|th|\\.)?\\s+${month}\\.?(?:\\s+\\d{4})?|${month}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|(?:next|this|nächste[nrms]?|naechste[nrms]?|diese[nrms]?)\\s+${weekday}|${weekday}|today|tomorrow|yesterday|heute|übermorgen|uebermorgen|morgen|gestern|in\\s+${number}\\s+${unit})`;

function parseAtom(text: string, reference: ISODate, rangeEnd = false): ISODate | null {
  const relative = new RegExp(`^(?:${afterNext})\\s+(${weekday}|woche|wochenende)$`, "iu").exec(text.normalize("NFC"));
  if (relative) {
    const target = relative[1].toLowerCase();
    const day = new Date(`${reference}T12:00:00Z`).getUTCDay();
    if (target === "woche") return addCalendarDays(reference, (8 - (day || 7)) + 7);
    const weekdays = ["sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"];
    const aliases = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const desired = target === "wochenende" ? 6 : weekdays.indexOf(target) >= 0 ? weekdays.indexOf(target) : aliases.findIndex(name => target.startsWith(name));
    return addCalendarDays(reference, ((desired - day + 7) % 7 || 7) + 7);
  }
  const numeric = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{4})|\.)?$/.exec(text);
  if (numeric) {
    const day = Number(numeric[1]), month = Number(numeric[2]);
    let year = Number(numeric[3] ?? reference.slice(0, 4));
    let result = isoCalendarDate(year, month, day);
    if (result && !numeric[3] && result < reference && (!rangeEnd || month < Number(reference.slice(5, 7)))) result = isoCalendarDate(++year, month, day);
    return result;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split("-").map(Number);
    return isoCalendarDate(year, month, day);
  }
  const normalized = text.replace(/uebermorgen/gi, "übermorgen").replace(/naechste/gi, "nächste").replace(/maerz/gi, "März");
  const ref = { instant: new Date(`${reference}T12:00:00Z`), timezone: 0 };
  for (const locale of [en.GB, de]) {
    const result = locale.parse(normalized, ref, { forwardDate: true }).find(value => value.index === 0 && value.text.length === normalized.length && (value.start.isCertain("day") || value.start.isCertain("weekday")));
    if (result) {
      let date = isoCalendarDate(result.start.get("year")!, result.start.get("month")!, result.start.get("day")!);
      // A missing-year named end must not turn a reversed same-month range into a year-long task.
      if (date && rangeEnd && new RegExp(month, "iu").test(text) && !/\d{4}/.test(text) && Number(date.slice(0, 4)) > Number(reference.slice(0, 4)) && Number(date.slice(5, 7)) >= Number(reference.slice(5, 7))) {
        date = isoCalendarDate(Number(reference.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8)));
      }
      if (date && rangeEnd && date < reference && !/\d{4}/.test(text) && Number(date.slice(5, 7)) < Number(reference.slice(5, 7))) {
        return isoCalendarDate(Number(reference.slice(0, 4)) + 1, Number(date.slice(5, 7)), Number(date.slice(8)));
      }
      return date;
    }
  }
  return null;
}

/** Locale-specific Chrono parsing with strict European numeric pre-parsing. */
export function parseDates(input: string, today: ISODate): { dates: DateRange; spans: Span[]; warnings: string[] } {
  const spans: Span[] = [], warnings: string[] = [];
  const values: DateRange[] = [];
  const range = new RegExp(`(?<![\\p{L}\\p{N}])(?:from|von|vom)\\s+(${atom})\\s+(?:to|until|bis)\\s+(${atom})(?:[.,;](?![\\p{L}\\p{N}]))?(?![\\p{L}\\p{N}./])`, "giu");
  for (const match of input.matchAll(range)) {
    const start = parseAtom(match[1], today), end = parseAtom(match[2], start ?? today, true);
    spans.push({ start: match.index, end: match.index + match[0].length });
    if (!start || !end) warnings.push(`Invalid date range: “${match[0]}”.`);
    else if (end < start) warnings.push("Deadline must be on or after the start date.");
    else values.push({ start, end });
  }
  const remaining = maskSpans(input, spans);
  const single = new RegExp(`(?<![\\p{L}\\p{N}])(?:(?:until|by|before|on|bis|am)\\s+(?:(?:the|zum|zur)\\s+)?)?(${atom})(?:[.,;](?![\\p{L}\\p{N}]))?(?![\\p{L}\\p{N}./])`, "giu");
  for (const match of remaining.matchAll(single)) {
    spans.push({ start: match.index, end: match.index + match[0].length });
    const end = parseAtom(match[1], today);
    if (!end) warnings.push(`Invalid date: “${match[1]}”.`);
    else if (end < today) warnings.push("Deadline is before today. Use an explicit range to set an earlier start.");
    else values.push({ start: today, end });
  }
  // Date-looking but malformed numeric values must never turn into apparently valid undated tasks.
  const residue = maskSpans(input, spans);
  if (/\b(?:from|von|vom)\s+(?:to|until|bis)\b/iu.test(residue)) warnings.push("Incomplete date range. Supply valid start and end dates.");
  for (const match of residue.matchAll(/(?<![\p{L}\p{N}])(?:\d{1,4}[./-]){1,2}\d{1,4}\.?/gu)) {
    warnings.push(`Unrecognized date: “${match[0]}”.`);
  }
  if (values.length > 1) warnings.push("Several dates were found. Use a single deadline or an explicit from/to range.");
  return { dates: values.length === 1 ? values[0] : { start: today, end: null }, spans, warnings };
}

export function recurrenceNumber(value: string): number {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, ein: 1, eine: 1, einen: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10 };
  return words[value.toLowerCase()] ?? Number(value);
}
export const recurrencePattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:(?:every|alle)\\s+(?:(${number})\\s+)?(${unit})|daily|weekly|monthly|yearly|täglich|taeglich|wöchentlich|woechentlich|monatlich|jährlich|jaehrlich)(?![\\p{L}\\p{N}])`, "giu");

// Public helper for calendar-based recurrence consumers; day/week do not use elapsed milliseconds.
export { addCalendarDays };
