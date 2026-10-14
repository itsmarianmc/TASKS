import { calendarToday, isCalendarDate } from "./calendar";
import { maskSpans, parseDates, recurrenceNumber, recurrencePattern, type Span } from "./parser-dates";
import type { Graph, ParseContext, ParserAlias, ParseResult, Priority, RecurrenceRule, Tag } from "./types";

export const parserMode = { label: "Deterministic · DE + EN" } as const;
export function normalizeParserText(value: string): string {
  return value.toLowerCase().replace(/æ/g, "ae").replace(/ß/g, "ss").normalize("NFKD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();
}
interface Candidate { id: string; phrase: string }
interface Mention extends Span { ids: string[]; explicit: boolean; clause: boolean; fuzzy: boolean }
const compact = (value: string) => normalizeParserText(value).replace(/[\s_-]/g, "");

function distanceOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, differences = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++differences > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return differences + (i < a.length || j < b.length ? 1 : 0) <= 1;
}

function entityMentions(text: string, candidates: Candidate[], marker: "#" | "@", fuzzy: boolean): Mention[] {
  const words = [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu)];
  const mentions: Mention[] = [];
  const maxWords = Math.max(1, ...candidates.map(value => value.phrase.split(/\s+/).length));
  for (let i = 0; i < words.length; i++) {
    const first = words[i], start = first.index;
    const prefix = text[start - 1];
    if ((prefix === "#" || prefix === "@") && prefix !== marker) continue;
    const explicit = prefix === marker;
    for (let size = Math.min(maxWords, words.length - i); size >= 1; size--) {
      const last = words[i + size - 1], end = last.index + last[0].length;
      const phrase = text.slice(start, end);
      if (size > 1 && !/^[\p{L}\p{N}_\s-]+$/u.test(phrase)) continue;
      const normalized = normalizeParserText(phrase);
      const before = text.slice(0, explicit ? start - 1 : start);
      const clauseMatch = (marker === "#" ? /\b(?:in|as|als|for|für|to)\s+$/iu : /\b(?:in|as|als|for|für)\s+$/iu).exec(before);
      const clause = !!clauseMatch;
      const exact = candidates.filter(value => normalizeParserText(value.phrase) === normalized || (explicit && compact(value.phrase) === compact(phrase)));
      // One edit is accepted only in an explicit token or relational clause and for long names.
      const similar = !exact.length && fuzzy && (explicit || clause) && normalized.length >= 6
        ? candidates.filter(value => normalizeParserText(value.phrase).length >= 6 && distanceOne(normalizeParserText(value.phrase), normalized)) : [];
      const hits = exact.length ? exact : similar;
      if (!hits.length) continue;
      mentions.push({ start: clauseMatch ? clauseMatch.index : explicit ? start - 1 : start, end,
        ids: [...new Set(hits.map(value => value.id))], explicit, clause, fuzzy: !exact.length });
      i += size - 1;
      break;
    }
  }
  return mentions;
}

/** Browser-safe. Never calls a service, invents relation IDs, or changes the graph. */
export function parseQuickAdd(input: string, graph: Graph, aliases: ParserAlias[] = [], context: ParseContext = {}, knownTags: Tag[] = []): ParseResult {
  const warnings: string[] = [];
  const text = input.normalize("NFC").replace(/\s+/g, " ").trim();
  let today = context.today;
  if (!today) {
    try { today = calendarToday(context.timezone ?? "Europe/Berlin"); }
    catch { today = calendarToday("Europe/Berlin"); warnings.push("Invalid calendar timezone. Correct it before saving."); }
  }
  if (!isCalendarDate(today)) {
    today = calendarToday("Europe/Berlin");
    warnings.push("Invalid reference date. Correct it before saving.");
  }
  if (text.length > 10000) return { input, title: text.slice(0, 2000), projectId: null, areaId: null, dates: { start: today, end: null }, tags: [], priority: "none", recurrenceRule: null, confidence: 0, warnings: ["Input exceeds 10,000 characters."], valid: false, needsResolution: true };
  const spans: Span[] = [], tags: string[] = [];
  for (const match of text.matchAll(/\[([^\[\]]*)\]/g)) {
    const tag = match[1].trim();
    if (!tag || tag.length > 64) warnings.push("Tags must contain between 1 and 64 characters.");
    else {
      const canonical = knownTags.find(value => normalizeParserText(value.name) === normalizeParserText(tag))?.name ?? tag;
      if (!tags.some(value => normalizeParserText(value) === normalizeParserText(canonical))) tags.push(canonical);
    }
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  if (tags.length > 50) warnings.push("A task supports at most 50 tags.");
  let recurrenceRule: RecurrenceRule | null = null;
  for (const match of maskSpans(text, spans).matchAll(recurrencePattern)) {
    const interval = match[1] ? recurrenceNumber(match[1]) : 1;
    const unit = normalizeParserText(match[2] ?? match[0]);
    const frequency = /week|woch/.test(unit) ? "week" : /month|monat/.test(unit) ? "month" : /year|jahr/.test(unit) ? "year" : "day";
    if (recurrenceRule) warnings.push("Several recurrence rules were found. Choose one.");
    else if (!Number.isInteger(interval) || interval < 1 || interval > 365) warnings.push("Recurrence interval must be between 1 and 365.");
    else recurrenceRule = { frequency, interval };
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  let priority: Priority = "none";
  const priorityRank: Record<Priority, number> = { none: 0, low: 1, medium: 2, high: 3, urgent: 4 };
  for (const match of maskSpans(text, spans).matchAll(/(?<!\S)(!{1,3})(?!\S)|(?<![\p{L}\p{N}])(?:high priority|low priority|medium priority|hohe priorität|niedrige priorität|mittlere priorität)(?![\p{L}\p{N}])|^(?:urgent|dringend)(?::|\s+)|(?<![\p{L}\p{N}])(?:urgent|dringend)$/giu)) {
    const normalized = normalizeParserText(match[0]);
    const parsed: Priority = match[1] ? (["none", "medium", "high", "urgent"] as const)[match[1].length] : /urgent|dringend/.test(normalized) ? "urgent" : /low|niedrige/.test(normalized) ? "low" : /medium|mittlere/.test(normalized) ? "medium" : "high";
    if (priority !== "none" && priority !== parsed) warnings.push("Several different priorities were found. Choose one.");
    if (priorityRank[parsed] > priorityRank[priority]) priority = parsed;
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  const candidateList = (type: "project" | "area"): Candidate[] => {
    const entities = type === "project" ? graph.projects : graph.areas;
    const ids = new Set(entities.map(value => value.id));
    return [...entities.flatMap(value => [{ id: value.id, phrase: value.name }, ...(type === "area" && normalizeParserText(value.name) === "hausaufgaben" ? [{ id: value.id, phrase: "Hausaufgabe" }] : [])]), ...aliases.filter(value => value.entityType === type && ids.has(value.entityId)).map(value => ({ id: value.entityId, phrase: value.alias }))];
  };
  const beforeDates = maskSpans(text, spans);
  const explicitProjects = entityMentions(beforeDates, candidateList("project"), "#", true).filter(value => value.explicit);
  const explicitAreas = entityMentions(beforeDates, candidateList("area"), "@", true).filter(value => value.explicit);
  const explicitMentions = [...explicitProjects, ...explicitAreas];
  // Even unknown explicit tokens are protected from date parsing (#Tomorrow is a project request).
  const unknownTokens: Span[] = [];
  for (const match of maskSpans(beforeDates, explicitMentions).matchAll(/(?<!\S)[#@][\p{L}\p{N}_-]*/gu)) {
    warnings.push(`Couldn’t match “${match[0]}”. Choose a project or area.`);
    unknownTokens.push({ start: match.index, end: match.index + match[0].length });
  }
  const dateResult = parseDates(maskSpans(text, [...spans, ...explicitMentions, ...unknownTokens]), today);
  spans.push(...dateResult.spans); warnings.push(...dateResult.warnings);
  const working = maskSpans(text, [...spans, ...explicitMentions]);
  if (dateResult.spans.length && /\b(?:before|after|vor|nach)\s+\p{L}/iu.test(working)) warnings.push("Couldn't infer the full date phrase. Review the dates.");
  const projects = [...explicitProjects, ...entityMentions(working, candidateList("project"), "#", true)];
  const areas = [...explicitAreas, ...entityMentions(working, candidateList("area"), "@", true)];
  // Overlapping project/area names must be explicitly scoped rather than arbitrarily consumed twice.
  const overlaps = projects.some(project => areas.some(area => project.start < area.end && area.start < project.end));
  if (overlaps) warnings.push("A name matches both a project and an area. Use #Project and @Area.");
  function select(mentions: Mention[], type: "project" | "area", defaultId?: string): string | null {
    const explicit = mentions.filter(value => value.explicit);
    const chosen = explicit.length ? explicit : mentions;
    const ids = [...new Set(chosen.flatMap(value => value.ids))];
    if (chosen.some(value => value.ids.length > 1) || ids.length > 1) { warnings.push(`Ambiguous ${type}. Choose the intended ${type}.`); return null; }
    if (ids.length) return ids[0];
    if (defaultId) {
      const entities = type === "project" ? graph.projects : graph.areas;
      if (entities.some(value => value.id === defaultId)) return defaultId;
      warnings.push(`The ${type} context is no longer available.`);
    }
    return null;
  }
  const projectId = select(projects, "project", context.projectId);
  // Explicit project selection overrides an incidental area view default when the project has one area.
  const project = graph.projects.find(value => value.id === projectId);
  const inferredArea = project?.areaIds.length === 1 && graph.areas.some(value => value.id === project.areaIds[0]) ? project.areaIds[0] : null;
  let areaId = select(areas, "area", projects.length && inferredArea ? inferredArea : context.areaId);
  if (!areaId && !areas.length && inferredArea) areaId = inferredArea;
  if (project && areaId && !project.areaIds.includes(areaId)) warnings.push(`Project “${project.name}” does not belong to area “${graph.areas.find(value => value.id === areaId)?.name}”.`);
  if (!projectId) warnings.push("Choose a project.");
  if (!areaId) warnings.push("Choose an area.");
  // Only consume mentions belonging to a unique selection. Unresolved phrases stay editable.
  const mentions = overlaps ? [] : [
    ...projects.filter(value => value.ids.length === 1 && value.ids[0] === projectId),
    ...areas.filter(value => value.ids.length === 1 && value.ids[0] === areaId),
  ];
  const relationalSpans = mentions.filter(value => value.explicit || value.clause);
  spans.push(...relationalSpans);
  const withoutRelations = maskSpans(text, spans);
  // Bare subject words remain useful when removing all matches would leave an empty title.
  const bare = mentions.filter(value => !value.explicit && !value.clause);
  const withoutBare = maskSpans(withoutRelations, bare).replace(/\s+/g, " ").trim();
  const title = (withoutBare || withoutRelations.replace(/\s+/g, " ").trim()).replace(/\s+([,;])/g, "$1").trim();
  if (!title) warnings.push("Enter a task title.");
  if (title.length > 2000) warnings.push("Task title exceeds 2,000 characters.");
  const fuzzyCount = mentions.filter(value => value.fuzzy).length;
  const uniqueWarnings = [...new Set(warnings)];
  const valid = uniqueWarnings.length === 0;
  return { input, title, projectId, areaId, dates: dateResult.dates, tags, priority, recurrenceRule,
    confidence: valid ? Math.max(0.8, 1 - fuzzyCount * 0.08) : Math.max(0, 0.65 - uniqueWarnings.length * 0.12),
    warnings: uniqueWarnings, valid, needsResolution: !valid };
}
