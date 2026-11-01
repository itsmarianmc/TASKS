import type { ISODate } from "./types";

/** Calendar dates never pass through the browser's local timezone. */
export function isoCalendarDate(year: number, month: number, day: number): ISODate | null {
  if (![year, month, day].every(Number.isInteger) || year < 100 || year > 9999) return null;
  if (month < 1 || month > 12) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > days[month - 1]) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** undefined is an editable invalid/partial draft, null is an intentional clear. */
export function validatedDateDraft(text: string, badInput = false): ISODate | null | undefined {
  if (badInput) return undefined;
  if (!text) return null;
  return isCalendarDate(text) ? text : undefined;
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return isoCalendarDate(year, month, day) === value;
}

export function calendarToday(timezone = "Europe/Berlin", instant = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addCalendarDays(value: ISODate, amount: number): ISODate {
  if (!isCalendarDate(value) || !Number.isInteger(amount)) throw new RangeError("Invalid calendar date or day offset.");
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

/** Missing endpoints are unbounded; an entirely undated task is not scheduled. */
export function intervalOverlaps(start: ISODate | null, end: ISODate | null, from: ISODate, to: ISODate): boolean {
  return !!(start || end) && (!start || start <= to) && (!end || end >= from);
}
