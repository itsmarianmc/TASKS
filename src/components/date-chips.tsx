"use client";
import { useTranslation } from "./localization";
import { isCalendarDate } from "@/lib/calendar";
export function DateChips({ start, end, formatDate }: { start: string | null; end: string | null; formatDate?: (date: string) => string }) {
  const { t, locale } = useTranslation();
  const displayDate = formatDate ?? ((date: string) => shortDate(date, locale));
  start = start && isCalendarDate(start) ? start : null;
  end = end && isCalendarDate(end) ? end : null;
  return <>
    {start && start !== end && <time className="meta-chip meta-start" dateTime={start} title={t("ui.start_date")}>{displayDate(start)}</time>}
    {(start || end) && (start !== end || !start) && <span className="date-separator" aria-hidden="true"> → </span>}
    {end && <time className="meta-chip meta-end" dateTime={end} title={t("ui.end_date")}>{displayDate(end)}</time>}
  </>;
}

function shortDate(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}
