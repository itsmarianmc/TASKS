import { describe, expect, it, vi } from "vitest";
import { parseQuickAdd } from "@/lib/parser";
import { parseTaskCapture } from "@/lib/server/ai/fallback";
import type { Graph } from "@/lib/types";

const graph: Graph = { tasks: [], syncedAt: null,
  areas: [{ id: "homework", name: "Hausaufgaben", projectIds: ["english"], type: null, url: "" }],
  projects: ["Englisch", "Mathe", "Physik", "Geschichte"].map(name => ({ id: name === "Englisch" ? "english" : name, name, areaIds: ["homework"], dates: { start: null, end: null }, status: null, priority: null, url: "" })),
};
const aliases = [{ id: "alias", entityType: "area" as const, entityId: "homework", alias: "Hausaufgabe" }];
const context = { today: "2026-10-04", timezone: "Europe/Berlin", projectId: "english" };
const parse = (input: string, today = context.today) => parseQuickAdd(input, graph, aliases, { ...context, today });

describe("German after-next dates", () => {
  it.each(["übernächsten Freitag", "über nächsten Freitag", "Übernächster Freitag", "übernächste Freitag", "uebernaechsten Freitag", "über  nächsten   Freitag", "u\u0308berna\u0308chsten Freitag", "übernächsten Freitag.", "über nächsten Freitag,"])("extracts the entire phrase: %s", phrase => {
    expect(parse(`Präsentation bis zum ${phrase}`)).toMatchObject({ title: "Präsentation", dates: { start: "2026-10-04", end: "2026-10-16" }, valid: true });
  });
  it.each([["Montag", "12"], ["Dienstag", "13"], ["Mittwoch", "14"], ["Donnerstag", "15"], ["Freitag", "16"], ["Samstag", "17"], ["Sonntag", "18"]])("finds the second upcoming %s", (weekday, day) => {
    expect(parse(`Vortrag übernächsten ${weekday}`).dates.end).toBe(`2026-10-${day}`);
  });
  it.each(["übernächste Woche", "über nächste Woche"])("uses the Monday after next for %s", phrase => expect(parse(`Vortrag ${phrase}`).dates.end).toBe("2026-10-12"));
  it.each(["übernächstes Wochenende", "über nächstes Wochenende"])("uses the Saturday after next for %s", phrase => expect(parse(`Vortrag ${phrase}`).dates.end).toBe("2026-10-17"));
  it.each([
    ["Mathe bis übernächsten Montag", "Mathe", "2026-10-12"],
    ["Physik Hausaufgabe übernächsten Freitag", "Physik Hausaufgabe", "2026-10-16"],
    ["Geschichte Präsentation bis zum übernächsten Mittwoch", "Präsentation", "2026-10-14"],
    ["Englisch bis über nächsten Freitag", "Englisch", "2026-10-16"],
    ["Präsentation in Englisch bis übernächsten Freitag als Hausaufgabe", "Präsentation", "2026-10-16"],
  ])("cleans titles and relations in %s", (input, title, end) => expect(parse(input)).toMatchObject({ title, dates: { start: context.today, end }, valid: true }));
  it.each(["bis nächsten Freitag", "bis Freitag"])("preserves %s", phrase => expect(parse(`Präsentation ${phrase}`)).toMatchObject({ title: "Präsentation", dates: { end: "2026-10-09" } }));
  it("uses calendar arithmetic across year and DST boundaries, including a reference Friday", () => {
    expect(parse("Vortrag übernächsten Freitag", "2026-10-09").dates.end).toBe("2026-10-23");
    expect(parse("Vortrag übernächsten Sonntag", "2026-10-18").dates.end).toBe("2026-11-01");
    expect(parse("Vortrag übernächsten Freitag", "2026-12-27").dates.end).toBe("2027-01-08");
  });
  it.each(["übernächsten", "über nächsten"])("never calls Gemini for the mandatory %s example", async phrase => {
    const ai = vi.fn();
    const result = await parseTaskCapture(`Präsentation in Englisch bis ${phrase} Freitag als Hausaufgabe`, graph, [], context, [], undefined, ai, { enabled: true, apiKey: "test", model: "test", timeoutMs: 1000, confidenceThreshold: .75 });
    expect(result).toMatchObject({ fallback: "not needed", result: { title: "Präsentation", projectId: "english", areaId: "homework", dates: { start: "2026-10-04", end: "2026-10-16" } } });
    expect(ai).not.toHaveBeenCalled();
  });
});
