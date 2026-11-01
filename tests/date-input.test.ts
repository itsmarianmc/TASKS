import { expect, it, vi } from "vitest";
import { isCalendarDate, validatedDateDraft } from "@/lib/calendar";

it.each(["20261-10-31", "2026-1", "2026-10-", "10/31/20261", "2026-02-29", "2026-04-31", "2026-13-01", "0000-01-01", "1900-02-29"])("keeps invalid draft %s out of shared state without constructing Date", value => {
  const date = vi.spyOn(globalThis, "Date");
  try { expect(validatedDateDraft(value)).toBeUndefined(); expect(date).not.toHaveBeenCalled(); } finally { date.mockRestore(); }
});
it("distinguishes native partial input from clearing and accepts real ISO/leap dates", () => {
  expect(validatedDateDraft("", true)).toBeUndefined();
  expect(validatedDateDraft("")).toBeNull();
  expect(validatedDateDraft("2026-10-31")).toBe("2026-10-31");
  expect(validatedDateDraft("2028-02-29")).toBe("2028-02-29");
  expect(isCalendarDate("2000-02-29")).toBe(true);
});
