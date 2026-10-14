import type { ISODate } from "./types";

/** Calendar dates never pass through the browser's local timezone. */
export function isoCalendarDate(year: number, month: number, day: number): ISODate | null {
  if (![year, month, day].every(Number.isInteger) || year < 100 || year > 9999) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
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
