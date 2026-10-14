import { describe, expect, it } from "vitest";
import { parseQuickAdd, normalizeParserText } from "@/lib/parser";
import { addCalendarDays, calendarToday } from "@/lib/calendar";
import type { Graph, ParserAlias } from "@/lib/types";

const graph: Graph = { tasks: [], syncedAt: null,
  areas: [ { id: "homework", name: "Hausaufgaben", type: null, url: "", projectIds: ["english", "physics"] }, { id: "web", name: "Web Development", type: null, url: "", projectIds: ["taesks"] } ],
  projects: [ { id: "english", name: "Englisch", areaIds: ["homework"], status: null, priority: null, dates: { start: null, end: null }, url: "" }, { id: "physics", name: "Physik", areaIds: ["homework"], status: null, priority: null, dates: { start: null, end: null }, url: "" }, { id: "taesks", name: "TÆSKS", areaIds: ["web"], status: null, priority: null, dates: { start: null, end: null }, url: "" } ] };
const aliases: ParserAlias[] = [
  { id: "a1", entityType: "project", entityId: "english", alias: "English" },
  { id: "a2", entityType: "project", entityId: "physics", alias: "Physics" },
  { id: "a3", entityType: "area", entityId: "homework", alias: "Homework" },
  { id: "a4", entityType: "area", entityId: "homework", alias: "Hausaufgabe" },
];
const parse = (text: string) => parseQuickAdd(text, graph, aliases, { today: "2026-10-03" });
const inEnglish = (text: string) => parseQuickAdd(text, graph, aliases, { today: "2026-10-03", projectId: "english" });

describe("project prepositions", () => {
  const projects = [
    { ...graph.projects[2], id: "nook-project", name: "Nook" },
    { ...graph.projects[2], id: "healthsync-project", name: "HealthSync" },
  ];
  const changed: Graph = { ...graph, projects: [...graph.projects, ...projects] };
  const context = { today: "2026-10-03", projectId: "english", areaId: "homework" };
  it.each([
    ["Add Notification in Nook", "nook-project"],
    ["Add Notification for HealthSync", "healthsync-project"],
    ["Add Notification to Nook", "nook-project"],
  ])("resolves %s by graph name and by saved alias, overriding view context", (input, projectId) => {
    expect(parseQuickAdd(input, changed, aliases, context)).toMatchObject({ title: "Add Notification", projectId, areaId: "web", valid: true });
    const renamed = { ...changed, projects: changed.projects.map(project => projects.some(value => value.id === project.id) ? { ...project, name: `${project.name} App` } : project) };
    const savedAliases: ParserAlias[] = projects.map(project => ({ id: `alias-${project.id}`, entityType: "project", entityId: project.id, alias: project.name }));
    expect(parseQuickAdd(input, renamed, [...aliases, ...savedAliases], context)).toMatchObject({ title: "Add Notification", projectId, areaId: "web", valid: true });
  });
  it.each(["in", "for", "to"])("retains an unresolved %s phrase and requests a choice", preposition => {
    const input = `Add Notification ${preposition} Unknown`;
    expect(parseQuickAdd(input, changed, aliases, { today: context.today })).toMatchObject({ title: input, projectId: null, valid: false, needsResolution: true });
    const duplicate: ParserAlias = { id: "duplicate-nook", entityType: "project", entityId: "healthsync-project", alias: "Nook" };
    const ambiguous = `Add Notification ${preposition} Nook`;
    const result = parseQuickAdd(ambiguous, changed, [...aliases, duplicate], context);
    expect(result).toMatchObject({ title: ambiguous, projectId: null, valid: false, needsResolution: true });
    expect(result.warnings).toContain("Ambiguous project. Choose the intended project.");
  });
  it("ignores stale aliases without removing the phrase", () => {
    const stale: ParserAlias = { id: "stale", entityType: "project", entityId: "deleted-project", alias: "Gone" };
    expect(parseQuickAdd("Add Notification in Gone", changed, [stale], { today: context.today })).toMatchObject({ title: "Add Notification in Gone", projectId: null, needsResolution: true });
  });
  it.each(["in", "for", "to"])("retains %s Nook if neither its graph entry nor a valid alias exists", preposition => {
    const input = `Add Notification ${preposition} Nook`;
    const stale: ParserAlias = { id: "stale-nook", entityType: "project", entityId: "nook-project", alias: "Nook" };
    expect(parseQuickAdd(input, graph, [stale], { today: context.today, projectId: "nook-project" })).toMatchObject({ title: input, projectId: null, valid: false, needsResolution: true });
  });
  it("deduplicates a project name and saved aliases resolving to the same graph ID", () => {
    const repeated: ParserAlias[] = ["Nook", "nook"].map((alias, index) => ({ id: `repeat-${index}`, entityType: "project", entityId: "nook-project", alias }));
    expect(parseQuickAdd("Add Notification in Nook", changed, repeated, context)).toMatchObject({ title: "Add Notification", projectId: "nook-project", areaId: "web", valid: true, needsResolution: false });
  });
  it.each(["in", "for", "to"])("consumes %s together with an explicit project token", preposition => {
    expect(parseQuickAdd(`Add Notification ${preposition} #Nook`, changed, aliases, context)).toMatchObject({ title: "Add Notification", projectId: "nook-project", areaId: "web", valid: true });
  });
  it("keeps ambiguous explicit tokens and conflicting project phrases in the title", () => {
    const duplicate: ParserAlias = { id: "duplicate-nook", entityType: "project", entityId: "healthsync-project", alias: "Nook" };
    const explicit = "Add Notification in #Nook";
    expect(parseQuickAdd(explicit, changed, [...aliases, duplicate], context)).toMatchObject({ title: explicit, projectId: null, needsResolution: true });
    const conflicting = "Add Notification in Nook for HealthSync";
    expect(parseQuickAdd(conflicting, changed, aliases, context)).toMatchObject({ title: conflicting, projectId: null, needsResolution: true });
  });
  it("preserves relative dates and explicit valid project-area relations", () => {
    expect(parseQuickAdd("Add Notification to Nook in 2 weeks @WebDevelopment", changed, aliases, context)).toMatchObject({ title: "Add Notification", projectId: "nook-project", areaId: "web", dates: { start: context.today, end: "2026-10-17" }, valid: true });
    expect(parse("Make Presentation in English as Homework until the 10/10/2026")).toMatchObject({ title: "Make Presentation", projectId: "english", areaId: "homework", dates: { start: context.today, end: "2026-10-10" }, valid: true });
  });
});

describe("DE/EN deterministic quick add", () => {
  it("parses the exact mandatory English example", () => {
    expect(parse("Make Presentation in English as Homework until the 10/10/2026")).toMatchObject({ title: "Make Presentation", projectId: "english", areaId: "homework", dates: { start: "2026-10-03", end: "2026-10-10" }, valid: true, needsResolution: false });
  });
  it.each([
    ["Präsentation in Englisch als Hausaufgabe bis Freitag", "Präsentation", "english", "homework", "2026-10-03", "2026-10-09"],
    ["Physics homework tomorrow", "Physics homework", "physics", "homework", "2026-10-03", "2026-10-04"],
    ["Physik lernen von Montag bis Freitag", "lernen", "physics", "homework", "2026-10-05", "2026-10-09"],
    ["Study physics from 5 Oct to 10 Oct", "Study", "physics", "homework", "2026-10-05", "2026-10-10"],
    ["Fix API #TÆSKS @WebDevelopment until next Monday", "Fix API", "taesks", "web", "2026-10-03", "2026-10-05"],
    ["Make Presentation #English @Homework [school] tomorrow", "Make Presentation", "english", "homework", "2026-10-03", "2026-10-04"],
  ])("parses %s", (input, title, projectId, areaId, start, end) => {
    expect(parse(input)).toMatchObject({ title, projectId, areaId, dates: { start, end }, valid: true });
  });
  it.each([
    ["today", "2026-10-03"], ["heute", "2026-10-03"], ["tomorrow", "2026-10-04"], ["morgen", "2026-10-04"], ["übermorgen", "2026-10-05"], ["uebermorgen", "2026-10-05"],
    ["Friday", "2026-10-09"], ["nächsten Freitag", "2026-10-09"], ["next Friday", "2026-10-09"], ["in 2 weeks", "2026-10-17"], ["in 2 Wochen", "2026-10-17"], ["in three days", "2026-10-06"], ["in drei Tagen", "2026-10-06"],
    ["7 Oct", "2026-10-07"], ["03/10/2026", "2026-10-03"], ["12/10/2026", "2026-10-12"], ["10.12.2026", "2026-12-10"], ["am 12.10.", "2026-10-12"], ["2026-10-12", "2026-10-12"],
  ])("reads %s as a deadline", (date, expected) => {
    expect(inEnglish(`Do presentation ${date}`)).toMatchObject({ title: "Do presentation", dates: { start: "2026-10-03", end: expected }, valid: true });
  });
  it.each([
    ["vom 3.10. bis 18.10.", "2026-10-03", "2026-10-18"],
    ["from Friday to Monday", "2026-10-09", "2026-10-12"],
    ["von Freitag bis Montag", "2026-10-09", "2026-10-12"],
    ["from 30 Dec to 2 Jan", "2026-12-30", "2027-01-02"],
    ["vom 30.12. bis 2.1.", "2026-12-30", "2027-01-02"],
    ["from 30 Oct to 2 Nov", "2026-10-30", "2026-11-02"],
  ])("resolves explicit range %s", (range, start, end) => {
    expect(inEnglish(`Study ${range}`)).toMatchObject({ title: "Study", dates: { start, end }, valid: true });
  });
  it.each(["31/02/2026", "32.10.2026", "2026-02-30", "29 Feb 2027", "31 Apr", "03/10/26", "from 10 Oct 2026 to 5 Oct 2026", "from 10 Oct to 5 Oct", "vom 10.10. bis 5.10.", "from 5 Oct to unknown", "vom 5.10. bis unbekannt", "vom 10.10.2026 bis 5.10.2026", "yesterday", "until 1 Oct 2026", "tomorrow Friday"])("blocks invalid or conflicting dates %s", input => {
    expect(inEnglish(`Study ${input}`).valid).toBe(false);
    expect(inEnglish(`Study ${input}`).warnings.length).toBeGreaterThan(0);
  });
  it("defaults start to today even with no date; context infers a single area", () => {
    expect(inEnglish("Make Presentation")).toMatchObject({ title: "Make Presentation", dates: { start: "2026-10-03", end: null }, projectId: "english", areaId: "homework", valid: true });
    expect(parseQuickAdd("Make Presentation", graph, aliases, { today: "2026-10-03", areaId: "homework" })).toMatchObject({ projectId: null, areaId: "homework", valid: false });
  });
  it("never accepts contradictory explicit relations", () => {
    expect(parse("Make #English @WebDevelopment")).toMatchObject({ projectId: "english", areaId: "web", valid: false });
    expect(parse("Make #English #Physics @Homework")).toMatchObject({ projectId: null, valid: false });
  });
  it("requires a choice for duplicate aliases even in context", () => {
    const duplicate = [...aliases, { id: "duplicate", entityType: "project" as const, entityId: "physics", alias: "English" }];
    expect(parseQuickAdd("Make #English", graph, duplicate, { today: "2026-10-03", projectId: "english" })).toMatchObject({ projectId: null, valid: false });
  });
  it("does not invent IDs or use stale alias/context IDs", () => {
    expect(parse("Make #Imaginary @Homework")).toMatchObject({ projectId: null, valid: false });
    expect(parseQuickAdd("Make #Ghost", graph, [{ id: "bad", entityType: "project", entityId: "ghost", alias: "Ghost" }], { today: "2026-10-03", projectId: "ghost" })).toMatchObject({ projectId: null, valid: false });
  });
  it("protects explicit relation names from date parsing", () => {
    const changed: Graph = { ...graph, projects: [...graph.projects, { ...graph.projects[0], id: "tomorrow", name: "Tomorrow" }] };
    expect(parseQuickAdd("Make #Tomorrow @Homework Friday", changed, aliases, { today: "2026-10-03" })).toMatchObject({ title: "Make", projectId: "tomorrow", dates: { start: "2026-10-03", end: "2026-10-09" }, valid: true });
    expect(inEnglish("Make #Tomorrow")).toMatchObject({ dates: { start: "2026-10-03", end: null }, valid: false });
  });
  it("normalizes diacritics and Æ without corrupting capture offsets", () => {
    expect(normalizeParserText(" TÆSKS   Übung Straße ")).toBe("taesks ubung strasse");
    expect(parse("Repair in TAESKS @WebDevelopment tomorrow")).toMatchObject({ title: "Repair", projectId: "taesks", valid: true });
    expect(parse("Übung in TÆSKS @WebDevelopment tomorrow")).toMatchObject({ title: "Übung", projectId: "taesks", valid: true });
  });
  it("only accepts a long-name typo in an explicit token or relation clause", () => {
    expect(parse("Make #Englisc @Homework")).toMatchObject({ projectId: "english", valid: true, title: "Make" });
    expect(parse("Make in Englisc as Homework")).toMatchObject({ projectId: "english", valid: true });
    expect(parse("Make Englisc homework")).toMatchObject({ projectId: null, valid: false });
    expect(parse("Make physicsology homework")).toMatchObject({ projectId: null, valid: false });
    expect(parse("Make #Phy @Homework")).toMatchObject({ projectId: null, valid: false });
  });
  it("blocks equally plausible fuzzy names", () => {
    const changed = { ...graph, projects: [...graph.projects, { ...graph.projects[0], id: "other", name: "Engliscx" }] };
    expect(parseQuickAdd("Make #Englisc", changed, aliases, { today: "2026-10-03" })).toMatchObject({ projectId: null, valid: false });
  });
  it("does not infer an area for a multi-area project", () => {
    const changed = { ...graph, projects: graph.projects.map(value => value.id === "english" ? { ...value, areaIds: ["homework", "web"] } : value) };
    expect(parseQuickAdd("Make #English", changed, aliases, { today: "2026-10-03" })).toMatchObject({ areaId: null, valid: false });
  });
  it("extracts recurrence before dates and supports units without requesting AI", () => {
    for (const [input, frequency, interval] of [["every 2 weeks", "week", 2], ["alle 2 Wochen", "week", 2], ["weekly", "week", 1], ["täglich", "day", 1], ["monatlich", "month", 1], ["every three days", "day", 3], ["yearly", "year", 1]] as const) {
      expect(inEnglish(`Study ${input} tomorrow`)).toMatchObject({ title: "Study", recurrenceRule: { frequency, interval }, dates: { start: "2026-10-03", end: "2026-10-04" }, valid: true });
    }
    expect(inEnglish("Study every 0 weeks").valid).toBe(false);
    expect(inEnglish("Study weekly daily").valid).toBe(false);
  });
  it("reads only conservative priority syntax, retaining ordinary punctuation", () => {
    for (const [input, priority] of [["Study !", "medium"], ["Study !!", "high"], ["Study !!!", "urgent"], ["urgent: Study", "urgent"], ["Study high priority", "high"], ["dringend Study", "urgent"]] as const) expect(inEnglish(input)).toMatchObject({ title: "Study", priority, valid: true });
    expect(inEnglish("Review urgent wording!")).toMatchObject({ title: "Review urgent wording!", priority: "none" });
    expect(inEnglish("Study ! !!!").valid).toBe(false);
  });
  it("deduplicates tags and returns existing canonical names", () => {
    expect(parseQuickAdd("Study [School] [school] tomorrow", graph, aliases, { today: "2026-10-03", projectId: "english" }, [{ id: "school", name: "school", color: null }])).toMatchObject({ title: "Study", tags: ["school"], valid: true });
  });
  it("rejects empty titles and invalid reference config", () => {
    expect(parse("#English @Homework tomorrow").valid).toBe(false);
    expect(parseQuickAdd("Study", graph, aliases, { today: "bad", projectId: "english" }).valid).toBe(false);
    expect(parseQuickAdd("Study", graph, aliases, { timezone: "Invalid/Zone", projectId: "english" }).valid).toBe(false);
  });
});

describe("timezone-safe calendar arithmetic", () => {
  it("uses Berlin's day at a UTC midnight boundary", () => expect(calendarToday("Europe/Berlin", new Date("2026-10-03T22:30:00Z"))).toBe("2026-10-04"));
  it("handles both daylight-saving boundaries", () => {
    expect(calendarToday("Europe/Berlin", new Date("2026-03-28T23:30:00Z"))).toBe("2026-03-29");
    expect(calendarToday("Europe/Berlin", new Date("2026-10-24T22:30:00Z"))).toBe("2026-10-25");
    expect(addCalendarDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addCalendarDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(() => addCalendarDays("2026-02-30", 1)).toThrow();
  });
});
