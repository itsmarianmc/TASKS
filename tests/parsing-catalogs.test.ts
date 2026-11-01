import { describe, expect, it } from "vitest";
import { parseQuickAdd, quotedSpans } from "@/lib/parser";
import { dateCatalogSchema } from "@/lib/catalogs";
import { preferencesPatchSchema } from "@/lib/schemas";
import { defaultPreferences } from "@/lib/server/repository";
import type { Graph } from "@/lib/types";

const graph: Graph = { tasks: [], syncedAt: null, areas: [{ id: "area", name: "Homework", projectIds: ["project"], type: null, url: "" }], projects: [{ id: "project", name: "English", areaIds: ["area"], dates: { start: null, end: null }, status: null, priority: null, url: "" }] };
const parse = (input: string, extra = {}) => parseQuickAdd(input, graph, [], { today: "2026-10-04", ...extra });
describe("literal quotation preference", () => {
  it.each(['"tomorrow #English @Homework [focus] high priority every 2 weeks"', '„tomorrow #English @Homework [focus] high priority every 2 weeks“', '“tomorrow #English @Homework [focus] high priority every 2 weeks”'])("preserves all token types in %s", quoted => {
    expect(parse(`Read ${quoted}`)).toMatchObject({ title: `Read ${quoted}`, projectId: null, areaId: null, dates: { end: null }, tags: [], priority: "none", recurrenceRule: null });
    expect(parse(`Read ${quoted}`, { literalQuotedText: false })).toMatchObject({ projectId: "project", areaId: "area", dates: { end: "2026-10-05" }, tags: ["focus"], priority: "high", recurrenceRule: { frequency: "week", interval: 2 } });
  });
  it("protects unmatched openers, allows apostrophes and keeps Unicode offsets", () => {
    expect(parse('Read "tomorrow #English').title).toBe('Read "tomorrow #English');
    expect(parse("Don't forget tomorrow").dates.end).toBe("2026-10-05");
    expect(parse('😀 Café „übermorgen“ #English @Homework tomorrow')).toMatchObject({ title: '😀 Café „übermorgen“', dates: { end: "2026-10-05" }, valid: true });
    expect(quotedSpans('😀 "morgen"')).toEqual([{ start: 3, end: 11 }]);
  });
  it("defaults older preferences to true and persists explicit opt-out", () => {
    expect({ ...defaultPreferences, ...preferencesPatchSchema.parse({ theme: "dark" }) }.literalQuotedText).toBe(true);
    expect(preferencesPatchSchema.parse({ literalQuotedText: false, language: "de-DE" })).toMatchObject({ literalQuotedText: false, language: "de-DE" });
  });
  it("preserves whitespace and punctuation inside literal quotes", () => {
    const quoted = '"tomorrow  ,\n  #English"';
    expect(parse(`Read ${quoted} @Homework`).title).toBe(`Read ${quoted}`);
  });
});
describe("data-driven semantic date phrases", () => {
  it.each([['übernächsten Dienstag', '2026-10-13'], ['Dienstag übernächste Woche', '2026-10-13'], ['Tuesday the week after next', '2026-10-13'], ['the week after next Tuesday', '2026-10-13'], ['next week', '2026-10-05'], ['week after next', '2026-10-12'], ['next weekend', '2026-10-10'], ['the weekend after next', '2026-10-17'], ['in three days', '2026-10-07'], ['in drei Tagen', '2026-10-07'], ['the day after tomorrow', '2026-10-06']])("consumes the whole phrase %s", (phrase, end) => {
    expect(parse(`Read #English @Homework ${phrase}`)).toMatchObject({ title: "Read", dates: { end }, valid: true });
  });
  it.each(['yesterday', 'the day before yesterday', 'gestern', 'vorgestern'])("recognizes %s without bypassing past-deadline validation", phrase => {
    const result = parse(`Read ${phrase}`);
    expect(result.title).toBe("Read"); expect(result.warnings.join(" ")).toContain("before today");
  });
  it("supports past starts in explicit ranges", () => expect(parse('Read from yesterday to tomorrow')).toMatchObject({ title: "Read", dates: { start: "2026-10-03", end: "2026-10-05" } }));
  it("preserves standalone same-day and explicit next-weekday behavior", () => {
    expect(parse("Read Friday", { today: "2026-10-09" }).dates.end).toBe("2026-10-09");
    expect(parse("Read next Friday", { today: "2026-10-09" }).dates.end).toBe("2026-10-16");
    expect(parse("Read this Friday", { today: "2026-10-09" }).dates.end).toBe("2026-10-09");
  });
  it("does not let invalid recognized durations fall through to another parser", () => {
    for (const [phrase, today] of [["in one month", "2026-01-31"], ["in 0 days", "2026-10-04"], ["tomorrow", "9999-12-31"]]) {
      const result = parse(`Read ${phrase}`, { today });
      expect(result.dates.end).toBeNull();
      expect(result.warnings.join(" ")).toContain("Invalid date");
    }
  });
  it("uses matching custom data literally, never as arbitrary regex", () => {
    const dateCatalog = dateCatalogSchema.parse({ lang: "fr-FR", name: "French", locName: "Français", phrases: { relativeDays: { tomorrow: ["demain", "a+b"] }, weekdays: { tuesday: ["mardi"] }, weekAfterNext: ["la semaine suivante"], weekStart: 1, durations: { prefixes: ["dans"], day: ["jours"], numbers: { Trois: 3 } } } });
    expect(parse("Read dans TROIS jours", { dateCatalog }).dates.end).toBe("2026-10-07");
    expect(parse('Read demain', { dateCatalog })).toMatchObject({ title: "Read", dates: { end: "2026-10-05" } });
    expect(parse('Read a+b', { dateCatalog }).dates.end).toBe("2026-10-05");
    expect(parse('Read aaab', { dateCatalog }).dates.end).toBe(null);
    expect(parse('Read mardi la semaine suivante', { dateCatalog })).toMatchObject({ title: "Read", dates: { end: "2026-10-13" } });
  });
});
