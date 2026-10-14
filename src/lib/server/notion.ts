import "server-only";
import { Client, LogLevel } from "@notionhq/client";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Area, DateRange, Diagnostic, Graph, NotionMapping, Project, Task, TaskInput } from "@/lib/types";
import type { NotionGraphCacheSnapshot, NotionGraphDelta, NotionGraphResponse, NotionGraphSyncResponse, NotionProperty, NotionSchemaResponse, TaskPatch } from "@/lib/notion-contracts";
import { datesSchema, taskInputSchema, httpUrlSchema } from "@/lib/schemas";
import { AppError } from "./http";

export const NOTION_API_VERSION = "2026-03-11";
type Source = "tasks" | "projects" | "areas";
export interface NotionConfig {
  token: string; timezone: string;
  databases: Record<Source, string>; dataSources: Record<Source, string>;
  mapping: NotionMapping;
  projectStatusProperty?: string; projectPriorityProperty?: string; projectDateProperty?: string; areaTypeProperty?: string;
}
export interface NotionTransport { request(input: { path: string; method: "get" | "post" | "patch"; body?: Record<string, unknown>; query?: Record<string, string | number> }): Promise<unknown> }
const uuid = z.string().regex(/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i).transform(value => value.replaceAll("-", "").toLowerCase().replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5"));
const key = (id: string) => id.replaceAll("-", "").toLowerCase();
const same = (a: string, b: string) => key(a) === key(b);
const normalized = (name: string) => name.toLowerCase().replace(/[\s_-]/g, "");
const doneNames = new Set(["done", "completed", "complete", "finished", "erledigt", "abgeschlossen", "fertig"]);
const openNames = new Set(["todo", "notstarted", "open", "offen", "nichtbegonnen"]);
const schemaProperty = z.object({ id: z.string(), name: z.string(), type: z.string(), relation: z.object({ data_source_id: uuid.optional(), database_id: uuid.optional() }).passthrough().optional(), status: z.object({ options: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()), groups: z.array(z.object({ id: z.string(), name: z.string(), option_ids: z.array(z.string()) }).passthrough()) }).optional() }).passthrough();
const dataSourceSchema = z.object({ object: z.literal("data_source"), id: uuid, properties: z.record(z.string(), schemaProperty), in_trash: z.boolean().optional() }).passthrough();
const pageSchema = z.object({ object: z.literal("page"), id: uuid, parent: z.object({ type: z.string(), data_source_id: uuid.optional() }).passthrough(), properties: z.record(z.string(), z.unknown()), url: httpUrlSchema, created_time: z.iso.datetime({ offset: true }), last_edited_time: z.iso.datetime({ offset: true }), in_trash: z.boolean().optional(), is_archived: z.boolean().optional() }).passthrough();
type RawPage = z.infer<typeof pageSchema>;
type RawProperty = z.infer<typeof schemaProperty>;
const listSchema = z.object({ results: z.array(z.unknown()), has_more: z.boolean(), next_cursor: z.string().nullable() }).passthrough();
const emptyGraph = (): Graph => ({ areas: [], projects: [], tasks: [], syncedAt: null });
const emptySchema = (): NotionSchemaResponse => ({ configured: false, apiVersion: NOTION_API_VERSION, diagnostics: [], properties: { tasks: [], projects: [], areas: [] }, completionCandidates: [], completion: null });
const checked = () => new Date().toISOString();
// Notion allows an average of three requests/second. Share a paced queue across
// adapters so simultaneous graph/schema reads do not produce a startup burst.
let requestQueue: Promise<void> = Promise.resolve();
let nextRequestAt = 0;
async function paced<T>(request: () => Promise<T>): Promise<T> {
  const previous = requestQueue;
  let release!: () => void;
  requestQueue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    nextRequestAt = Date.now() + 350;
    return await request();
  } finally { release(); }
}

export function notionConfig(mapping: NotionMapping = {}, env: Record<string, string | undefined> = process.env): NotionConfig {
  const override = (local: string | undefined, name: string, fallback?: string) => local || env[name] || fallback;
  return {
    token: env.NOTION_TOKEN || "", timezone: env.APP_TIMEZONE || "Europe/Berlin",
    databases: { tasks: env.NOTION_TASKS_DATABASE_ID || "", projects: env.NOTION_PROJECTS_DATABASE_ID || "", areas: env.NOTION_AREAS_DATABASE_ID || "" },
    dataSources: { tasks: env.NOTION_TASKS_DATA_SOURCE_ID || "", projects: env.NOTION_PROJECTS_DATA_SOURCE_ID || "", areas: env.NOTION_AREAS_DATA_SOURCE_ID || "" },
    mapping: {
      taskTitleProperty: override(mapping.taskTitleProperty, "NOTION_TASK_TITLE_PROPERTY", "Name"), taskDateProperty: override(mapping.taskDateProperty, "NOTION_TASK_DATE_PROPERTY", "Due Date"),
      taskAreaProperty: override(mapping.taskAreaProperty, "NOTION_TASK_AREA_PROPERTY", "Area"), taskProjectProperty: override(mapping.taskProjectProperty, "NOTION_TASK_PROJECT_PROPERTY", "Project"), taskHighlightProperty: override(mapping.taskHighlightProperty, "NOTION_TASK_HIGHLIGHT_PROPERTY", "Highlight"),
      projectTitleProperty: override(mapping.projectTitleProperty, "NOTION_PROJECT_TITLE_PROPERTY"), projectAreaProperty: override(mapping.projectAreaProperty, "NOTION_PROJECT_AREA_PROPERTY"), areaTitleProperty: override(mapping.areaTitleProperty, "NOTION_AREA_TITLE_PROPERTY"),
      completionProperty: override(mapping.completionProperty, "NOTION_TASK_COMPLETION_PROPERTY"), completionValue: override(mapping.completionValue, "NOTION_TASK_COMPLETION_VALUE"), reopenValue: override(mapping.reopenValue, "NOTION_TASK_REOPEN_VALUE"),
    },
    projectStatusProperty: env.NOTION_PROJECT_STATUS_PROPERTY, projectPriorityProperty: env.NOTION_PROJECT_PRIORITY_PROPERTY, projectDateProperty: env.NOTION_PROJECT_DATE_PROPERTY, areaTypeProperty: env.NOTION_AREA_TYPE_PROPERTY,
  };
}

function diagnostic(status: Diagnostic["status"], message: string, details?: string[]): Diagnostic { return { source: "notion", status, message, details, checkedAt: checked() }; }
export function notionError(error: unknown, operation: string): AppError {
  if (error instanceof AppError) return error;
  const correlationId = randomUUID();
  const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : null;
  console.error(JSON.stringify({ source: "notion", operation, status: status || 502, correlationId, errorType: error instanceof z.ZodError ? "InvalidRemoteResponse" : "RemoteError" }));
  const message = status === 401 || status === 403 ? "Notion access denied. Check the integration token and database sharing." : status === 404 ? "Notion database or page unavailable. Share all three databases with the integration." : status === 429 ? "Notion is rate limiting requests. Wait briefly, then refresh." : "Notion could not confirm this operation. Refresh before retrying a write.";
  return new AppError("NOTION_UNAVAILABLE", message, status === 429 ? 429 : 502, { source: "notion", operation, upstreamStatus: status, correlationId });
}

export function createNotionAdapter(config: NotionConfig, transport?: NotionTransport, options: { graphSnapshot?: NotionGraphCacheSnapshot | null; persistGraphSnapshot?: (snapshot: NotionGraphCacheSnapshot) => void } = {}) {
  // SDK retries are disabled: replaying an uncertain create could duplicate a task.
  const sdk = transport || new Client({ auth: config.token, notionVersion: NOTION_API_VERSION, timeoutMs: 15_000, retry: false, logLevel: LogLevel.ERROR, logger: () => {} });
  let schemaCache: { expires: number; schema: ResolvedSchema } | null = null;
  let graphCache: (NotionGraphCacheSnapshot & { expires: number }) | null = options.graphSnapshot ? { ...options.graphSnapshot, expires: 0 } : null;
  let schemaPending: { generation: number; promise: Promise<ResolvedSchema> } | null = null;
  let graphPending: { generation: number; promise: Promise<NotionGraphResponse> } | null = null;
  let schemaGeneration = 0;
  let graphGeneration = 0;
  const configured = !!config.token && Object.values(config.databases).every(Boolean);
  const missing = [!config.token ? "NOTION_TOKEN" : "", ...Object.entries(config.databases).filter(([, id]) => !id).map(([source]) => `NOTION_${source.toUpperCase()}_DATABASE_ID`)].filter(Boolean);
  const disabled = () => diagnostic("disabled", "Notion is not configured. Tasks are unavailable until setup is complete.", missing.map(name => `Missing ${name}`));
  type ResolvedSchema = { sources: Record<Source, { id: string; properties: RawProperty[] }>; fields: { taskTitle: RawProperty; taskDate: RawProperty; taskArea: RawProperty; taskProject: RawProperty; taskHighlight: RawProperty; projectTitle: RawProperty; projectArea: RawProperty; areaTitle: RawProperty; projectStatus?: RawProperty; projectPriority?: RawProperty; projectDate?: RawProperty; areaType?: RawProperty }; public: NotionSchemaResponse };
  async function call(path: string, method: "get" | "post" | "patch", operation: string, body?: Record<string, unknown>, query?: Record<string, string | number>) {
    try {
      const request = () => sdk.request({ path, method, ...(body ? { body } : {}), ...(query ? { query } : {}) });
      return await (transport ? request() : paced(request));
    }
    catch (error) { throw notionError(error, operation); }
  }
  function requireConfig() {
    if (!configured) throw new AppError("NOTION_DISABLED", "Configure Notion before creating or changing tasks.", 503);
    for (const id of [...Object.values(config.databases), ...Object.values(config.dataSources).filter(Boolean)]) if (!uuid.safeParse(id).success) throw new AppError("NOTION_CONFIG", "Notion database and data source IDs must be valid UUIDs.", 422);
  }
  async function resolveSource(source: Source) {
    const database = z.object({ data_sources: z.array(z.object({ id: uuid, name: z.string() })), in_trash: z.boolean().optional() }).parse(await call(`databases/${config.databases[source]}`, "get", "schema.database"));
    if (database.in_trash) throw new AppError("NOTION_SCHEMA", `${source} database is in the trash.`, 422);
    const explicit = config.dataSources[source];
    const selected = explicit ? database.data_sources.find(item => same(item.id, explicit)) : database.data_sources.length === 1 ? database.data_sources[0] : undefined;
    if (!selected) throw new AppError("NOTION_DATA_SOURCE", explicit ? `Configured ${source} data source does not belong to its database.` : `The ${source} database has ${database.data_sources.length} data sources. Set NOTION_${source.toUpperCase()}_DATA_SOURCE_ID explicitly.`, 422);
    const dataSource = dataSourceSchema.parse(await call(`data_sources/${selected.id}`, "get", "schema.properties"));
    if (!same(dataSource.id, selected.id)) throw new AppError("NOTION_SCHEMA", "Notion returned a different data source than requested.", 502);
    if (dataSource.in_trash) throw new AppError("NOTION_SCHEMA", `${source} data source is in the trash.`, 422);
    return { id: dataSource.id, properties: Object.values(dataSource.properties) };
  }
  async function resolveSchema(force = false): Promise<ResolvedSchema> {
    requireConfig();
    if (!force && schemaCache && schemaCache.expires > Date.now()) return schemaCache.schema;
    if (!schemaPending || schemaPending.generation !== schemaGeneration) {
      const generation = schemaGeneration;
      const promise = loadSchema(generation).finally(() => { if (schemaPending?.promise === promise) schemaPending = null; });
      schemaPending = { generation, promise };
    }
    const pending = schemaPending;
    const schema = await pending.promise;
    return pending.generation === schemaGeneration ? schema : resolveSchema(force);
  }
  async function loadSchema(generation: number): Promise<ResolvedSchema> {
    const sources = { areas: await resolveSource("areas"), projects: await resolveSource("projects"), tasks: await resolveSource("tasks") };
    const select = (source: Source, name: string | undefined, types: string[], label: string, predicate?: (property: RawProperty) => boolean): RawProperty => {
      const candidates = sources[source].properties.filter(prop => types.includes(prop.type) && (!predicate || predicate(prop)));
      const property = name ? candidates.find(prop => prop.name === name) : candidates.length === 1 ? candidates[0] : undefined;
      if (!property) throw new AppError("NOTION_SCHEMA", `${label}: ${name ? `property “${name}” is missing, has the wrong type or relation target` : "mapping is ambiguous or unavailable"}. Choose a mapping in Settings.`, 422);
      return property;
    };
    const targets = (target: Source) => (property: RawProperty) => !!property.relation && (property.relation.data_source_id ? same(property.relation.data_source_id, sources[target].id) : !!property.relation.database_id && same(property.relation.database_id, config.databases[target]));
    const optional = (source: Source, name: string | undefined, defaults: string[], types: string[], label: string) => name ? select(source, name, types, label) : sources[source].properties.find(prop => types.includes(prop.type) && defaults.includes(normalized(prop.name)));
    const m = config.mapping;
    const fields: ResolvedSchema["fields"] = {
      taskTitle: select("tasks", m.taskTitleProperty, ["title"], "Task title"), taskDate: select("tasks", m.taskDateProperty, ["date"], "Task date"),
      taskArea: select("tasks", m.taskAreaProperty, ["relation"], "Task area", targets("areas")), taskProject: select("tasks", m.taskProjectProperty, ["relation"], "Task project", targets("projects")), taskHighlight: select("tasks", m.taskHighlightProperty, ["checkbox"], "Highlight"),
      projectTitle: select("projects", m.projectTitleProperty, ["title"], "Project title"), projectArea: select("projects", m.projectAreaProperty, ["relation"], "Project areas", targets("areas")), areaTitle: select("areas", m.areaTitleProperty, ["title"], "Area title"),
      projectStatus: optional("projects", config.projectStatusProperty, ["status", "state"], ["status", "select"], "Project status"), projectPriority: optional("projects", config.projectPriorityProperty, ["priority", "priorität"], ["select", "status"], "Project priority"), projectDate: optional("projects", config.projectDateProperty, ["date", "deadline", "duedate"], ["date"], "Project date"), areaType: optional("areas", config.areaTypeProperty, ["type", "typ"], ["select", "status", "rich_text"], "Area type"),
    };
    const properties = (source: Source): NotionProperty[] => sources[source].properties.map(prop => ({ id: prop.id, name: prop.name, type: prop.type, options: prop.status?.options.map(option => ({ ...option, group: prop.status?.groups.find(group => group.option_ids.includes(option.id))?.name || null })) || [] }));
    const candidates = sources.tasks.properties.filter(prop => ["checkbox", "status"].includes(prop.type) && prop.id !== fields.taskHighlight.id);
    const selected = m.completionProperty ? candidates.find(prop => prop.name === m.completionProperty) : candidates.length === 1 ? candidates[0] : undefined;
    const details: string[] = [];
    let completion: NotionSchemaResponse["completion"] = null;
    if (!selected) details.push(m.completionProperty ? "The selected completion property is unavailable. Highlight cannot be used for completion." : candidates.length ? "Multiple completion properties exist. Select one in Settings." : "No completion property exists. Completion is disabled; the Notion schema is unchanged.");
    else if (selected.type === "checkbox") completion = { property: selected.name, type: "checkbox", completedValue: null, reopenValue: null, completedValues: [], enabled: true };
    else {
      const status = selected.status;
      if (!status) throw new AppError("NOTION_SCHEMA", "The completion status schema is unavailable.", 422);
      const doneOptions = status.options.filter(option => status.groups.some(group => doneNames.has(normalized(group.name)) && group.option_ids.includes(option.id)));
      const openOptions = status.options.filter(option => status.groups.some(group => openNames.has(normalized(group.name)) && group.option_ids.includes(option.id)));
      const choose = (explicit: string | undefined, group: typeof status.options, names: Set<string>) => explicit ? status.options.find(option => option.name === explicit)?.name || null : group.length === 1 ? group[0].name : status.options.filter(option => names.has(normalized(option.name))).length === 1 ? status.options.find(option => names.has(normalized(option.name)))!.name : null;
      const completedValue = choose(m.completionValue, doneOptions, doneNames);
      const reopenValue = choose(m.reopenValue, openOptions, openNames);
      const completedValues = [...new Set([...doneOptions.map(option => option.name), ...(completedValue ? [completedValue] : [])])];
      completion = { property: selected.name, type: "status", completedValue, reopenValue, completedValues, enabled: !!completedValue && !!reopenValue && !completedValues.includes(reopenValue) };
      if (!completion.enabled) details.push("Choose distinct completed and reopened status values in Settings. Status options will not be created.");
    }
    const schema: ResolvedSchema = { sources, fields, public: { configured: true, apiVersion: NOTION_API_VERSION, properties: { tasks: properties("tasks"), projects: properties("projects"), areas: properties("areas") }, completionCandidates: candidates.map(prop => prop.name), completion, diagnostics: [diagnostic("ok", "Notion schema verified.", details)] } };
    if (generation === schemaGeneration) schemaCache = { schema, expires: Date.now() + 60_000 };
    return schema;
  }
  async function publicSchema(force = false): Promise<NotionSchemaResponse> {
    if (!configured) return { ...emptySchema(), diagnostics: [disabled()] };
    try { return (await resolveSchema(force)).public; }
    catch (error) {
      const safe = notionError(error, "schema.read");
      // Expose available fields for fixing an incorrect mapping, even when validation fails.
      const properties = { tasks: [] as NotionProperty[], projects: [] as NotionProperty[], areas: [] as NotionProperty[] };
      try {
        requireConfig();
        for (const source of ["tasks", "projects", "areas"] as const) {
          const raw = await resolveSource(source);
          properties[source] = raw.properties.map(prop => ({ id: prop.id, name: prop.name, type: prop.type, options: prop.status?.options.map(option => ({ ...option, group: prop.status?.groups.find(group => group.option_ids.includes(option.id))?.name || null })) || [] }));
        }
      } catch { /* Source diagnostics already describe the failure. */ }
      return { ...emptySchema(), configured: true, properties, completionCandidates: properties.tasks.filter(prop => ["checkbox", "status"].includes(prop.type) && prop.name !== config.mapping.taskHighlightProperty).map(prop => prop.name), diagnostics: [diagnostic("error", safe.message)] };
    }
  }
  function value(page: RawPage, property: RawProperty) {
    const raw = page.properties[property.name];
    const base = z.object({ type: z.string() }).passthrough().parse(raw);
    if (base.type !== property.type) throw new AppError("NOTION_SCHEMA", `Page property “${property.name}” does not match its schema.`, 422);
    return base;
  }
  function title(page: RawPage, property: RawProperty) { return z.array(z.object({ plain_text: z.string() }).passthrough()).parse(value(page, property).title).map(text => text.plain_text).join(""); }
  function text(page: RawPage, property?: RawProperty): string | null {
    if (!property) return null;
    const raw = value(page, property);
    if (property.type === "rich_text") return z.array(z.object({ plain_text: z.string() }).passthrough()).parse(raw.rich_text).map(text => text.plain_text).join("") || null;
    return z.object({ name: z.string() }).nullable().parse(raw[property.type])?.name || null;
  }
  function calendar(input: string | null): string | null {
    if (!input) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return z.iso.date().parse(input);
    const instant = new Date(input);
    if (!Number.isFinite(instant.getTime())) throw new AppError("NOTION_DATE", "Notion returned an invalid date.", 422);
    const parts = new Intl.DateTimeFormat("en", { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
    const part = (name: string) => parts.find(value => value.type === name)!.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  }
  function dates(page: RawPage, property?: RawProperty): DateRange {
    if (!property) return { start: null, end: null };
    const dateValue = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
    const date = z.object({ start: dateValue, end: dateValue.nullable() }).nullable().parse(value(page, property).date);
    return datesSchema.parse({ start: calendar(date?.start || null), end: calendar(date?.end || null) });
  }
  async function relations(page: RawPage, property: RawProperty): Promise<string[]> {
    const raw = value(page, property);
    const relation = z.array(z.object({ id: uuid })).parse(raw.relation);
    if (raw.has_more !== true) return relation.map(item => item.id);
    const items: string[] = [];
    let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
      const result = listSchema.parse(await call(`pages/${page.id}/properties/${encodeURIComponent(decodeURIComponent(property.id))}`, "get", "relation.paginate", undefined, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }));
      for (const item of result.results) items.push(z.object({ type: z.literal("relation"), relation: z.object({ id: uuid }) }).parse(item).relation.id);
      cursor = result.has_more ? result.next_cursor || undefined : undefined;
      if (result.has_more && (!cursor || cursors.has(cursor))) throw new AppError("NOTION_PAGINATION", "Notion returned an incomplete relation page.", 502);
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return [...new Set(items)];
  }
  async function pages(sourceId: string, editedSince?: string): Promise<RawPage[]> {
    const items: RawPage[] = [];
    let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
      const result = listSchema.parse(await call(`data_sources/${sourceId}/query`, "post", "graph.paginate", { page_size: 100, ...(editedSince ? { filter: { timestamp: "last_edited_time", last_edited_time: { on_or_after: editedSince } } } : {}), ...(cursor ? { start_cursor: cursor } : {}) }));
      for (const item of result.results) {
        const page = pageSchema.parse(item);
        assertPageSource(page, sourceId);
        items.push(page);
      }
      cursor = result.has_more ? result.next_cursor || undefined : undefined;
      if (result.has_more && (!cursor || cursors.has(cursor))) throw new AppError("NOTION_PAGINATION", "Notion returned an incomplete data source page.", 502);
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return items;
  }
  function completed(page: RawPage, schema: ResolvedSchema): boolean {
    const c = schema.public.completion;
    if (!c) return false;
    const raw = z.object({ type: z.string() }).passthrough().parse(page.properties[c.property]);
    return c.type === "checkbox" ? z.boolean().parse(raw.checkbox) : c.completedValues.includes(z.object({ name: z.string() }).nullable().parse(raw.status)?.name || "");
  }
  async function mapTask(page: RawPage, schema: ResolvedSchema): Promise<Task> {
    const f = schema.fields;
    const areaIds = await relations(page, f.taskArea);
    const projectIds = await relations(page, f.taskProject);
    return { id: page.id, title: title(page, f.taskTitle), areaId: areaIds.length === 1 ? areaIds[0] : null, projectId: projectIds.length === 1 ? projectIds[0] : null, dates: dates(page, f.taskDate), highlight: z.boolean().parse(value(page, f.taskHighlight).checkbox), completed: completed(page, schema), url: page.url, createdAt: page.created_time, updatedAt: page.last_edited_time };
  }
  let graphFailure: AppError | null = null;
  const activePage = (page: RawPage) => !page.in_trash && !page.is_archived;
  function revisionAfter(previous: string | null) {
    const previousTime = previous ? Date.parse(previous) : 0;
    return new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString();
  }
  function itemChanges<T extends { id: string }>(before: T[], after: T[]) {
    const old = new Map(before.map(item => [key(item.id), item]));
    const next = new Map(after.map(item => [key(item.id), item]));
    return {
      changed: after.filter(item => JSON.stringify(old.get(key(item.id))) !== JSON.stringify(item)),
      deleted: before.filter(item => !next.has(key(item.id))).map(item => item.id),
    };
  }
  function graphDelta(before: Graph, after: Graph): Omit<NotionGraphDelta, "fromRevision" | "revision"> {
    const areas = itemChanges(before.areas, after.areas);
    const projects = itemChanges(before.projects, after.projects);
    const tasks = itemChanges(before.tasks, after.tasks);
    return { areas: areas.changed, projects: projects.changed, tasks: tasks.changed, deletedAreaIds: areas.deleted, deletedProjectIds: projects.deleted, deletedTaskIds: tasks.deleted };
  }
  function appendGraphHistory(history: NotionGraphDelta[], before: Graph, after: Graph): NotionGraphDelta[] {
    if (!before.syncedAt || !after.syncedAt || before.syncedAt === after.syncedAt) return history;
    return [...history, { fromRevision: before.syncedAt, revision: after.syncedAt, ...graphDelta(before, after) }].slice(-30);
  }
  async function mergePages<T extends { id: string }>(previous: T[], changed: RawPage[], mapPage: (page: RawPage) => Promise<T>): Promise<T[]> {
    const items = new Map(previous.map(item => [key(item.id), item]));
    for (const page of changed) {
      if (!activePage(page)) items.delete(key(page.id));
      else items.set(key(page.id), await mapPage(page));
    }
    return [...items.values()];
  }
  function assembleGraph(areas: Area[], projects: Project[], tasks: Task[], schema: ResolvedSchema, issues: string[]): NotionGraphResponse {
    for (const area of areas) area.projectIds = projects.filter(project => project.areaIds.some(id => same(area.id, id))).map(project => project.id);
    for (const project of projects) if (project.areaIds.some(id => !areas.some(area => same(area.id, id)))) issues.push(`Project “${project.name}” references an unavailable area.`);
    for (const task of tasks) {
      const project = projects.find(project => task.projectId && same(project.id, task.projectId));
      if (!task.areaId || !task.projectId || !project || !areas.some(area => same(area.id, task.areaId!)) || !project.areaIds.some(id => same(id, task.areaId!))) issues.push(`Task “${task.title}” has an invalid or unavailable area/project relation. Correct it before editing.`);
    }
    return { graph: { areas, projects, tasks, syncedAt: checked() }, diagnostics: [...schema.public.diagnostics, diagnostic("ok", "Notion tasks synced.", [...new Set(issues)])], completionEnabled: !!schema.public.completion?.enabled };
  }
  async function loadGraph(force: boolean): Promise<NotionGraphResponse> {
    const schema = await resolveSchema(force);
    const f = schema.fields;
    const areaPages = (await pages(schema.sources.areas.id)).filter(activePage);
    const projectPages = (await pages(schema.sources.projects.id)).filter(activePage);
    const taskPages = (await pages(schema.sources.tasks.id)).filter(activePage);
    const areas: Area[] = areaPages.map(page => ({ id: page.id, name: title(page, f.areaTitle), type: text(page, f.areaType), url: page.url, projectIds: [] }));
    const projects: Project[] = [];
    const issues: string[] = [];
    for (const page of projectPages) {
      const rawIds = await relations(page, f.projectArea);
      const areaIds = rawIds.filter(id => areas.some(area => same(area.id, id)));
      if (rawIds.length !== areaIds.length) issues.push(`Project “${title(page, f.projectTitle)}” references an unavailable area.`);
      projects.push({ id: page.id, name: title(page, f.projectTitle), areaIds, status: text(page, f.projectStatus), priority: text(page, f.projectPriority), dates: dates(page, f.projectDate), url: page.url });
    }
    const tasks: Task[] = [];
    for (const page of taskPages) tasks.push(await mapTask(page, schema));
    return assembleGraph(areas, projects, tasks, schema, issues);
  }
  async function loadGraphDelta(since: string): Promise<NotionGraphResponse> {
    if (!graphCache) return loadGraph(false);
    const schema = await resolveSchema();
    const f = schema.fields;
    const graph = graphCache.response.graph;
    const changedAreas = await pages(schema.sources.areas.id, since);
    const changedProjects = await pages(schema.sources.projects.id, since);
    const changedTasks = await pages(schema.sources.tasks.id, since);
    const areas = await mergePages(graph.areas, changedAreas, async page => ({ id: page.id, name: title(page, f.areaTitle), type: text(page, f.areaType), url: page.url, projectIds: [] }));
    const issues: string[] = [];
    const projects = await mergePages(graph.projects, changedProjects, async page => {
      const rawIds = await relations(page, f.projectArea);
      const areaIds = rawIds.filter(id => areas.some(area => same(area.id, id)));
      if (rawIds.length !== areaIds.length) issues.push(`Project “${title(page, f.projectTitle)}” references an unavailable area.`);
      return { id: page.id, name: title(page, f.projectTitle), areaIds, status: text(page, f.projectStatus), priority: text(page, f.projectPriority), dates: dates(page, f.projectDate), url: page.url };
    });
    const tasks = await mergePages(graph.tasks, changedTasks, page => mapTask(page, schema));
    return assembleGraph(areas, projects, tasks, schema, issues);
  }
  async function syncGraph(forceFull = false): Promise<NotionGraphResponse> {
    if (!configured) return { graph: emptyGraph(), diagnostics: [disabled()], completionEnabled: false };
    if (graphPending?.generation === graphGeneration) return graphPending.promise;
    const generation = graphGeneration;
    const startedAt = checked();
    const full = forceFull || !graphCache || !graphCache.lastFullSyncAt || Date.now() - Date.parse(graphCache.lastFullSyncAt) >= 60 * 60 * 1000;
    // The cleanup closure references the promise assigned after its first await.
    let promise!: Promise<NotionGraphResponse>;
    // eslint-disable-next-line prefer-const
    promise = (async () => {
      try {
        let response = full ? await loadGraph(forceFull) : await loadGraphDelta(graphCache!.cursor);
        if (generation !== graphGeneration) return syncGraph(forceFull);
        response = { ...response, graph: { ...response.graph, syncedAt: revisionAfter(graphCache?.response.graph.syncedAt ?? null) } };
        const history = graphCache ? appendGraphHistory(graphCache.history ?? [], graphCache.response.graph, response.graph) : [];
        const snapshot: NotionGraphCacheSnapshot = { response, cursor: startedAt, lastFullSyncAt: full ? startedAt : graphCache?.lastFullSyncAt ?? startedAt, history };
        graphCache = { ...snapshot, expires: Date.now() + 60_000 };
        graphFailure = null;
        try { options.persistGraphSnapshot?.(snapshot); } catch { console.error("Could not persist the Notion graph snapshot."); }
        return response;
      } finally { if (graphPending?.promise === promise) graphPending = null; }
    })();
    graphPending = { generation, promise };
    return promise;
  }
  function cachedResponse(): NotionGraphResponse {
    if (!graphCache) return { graph: emptyGraph(), diagnostics: [graphFailure ? diagnostic("error", graphFailure.message) : disabled()], completionEnabled: false };
    if (!graphFailure) return graphCache.response;
    return { ...graphCache.response, diagnostics: [...graphCache.response.diagnostics.filter(item => item.source !== "notion"), diagnostic("error", graphFailure.message, [`Showing the last synced graph from ${graphCache.response.graph.syncedAt}.`])] };
  }
  async function refreshGraph(forceFull = false): Promise<NotionGraphResponse> {
    try { return await syncGraph(forceFull); }
    catch (error) { graphFailure = notionError(error, "graph.sync"); throw graphFailure; }
  }
  async function readGraph(force = false, strict = false): Promise<NotionGraphResponse> {
    if (!configured) return { graph: emptyGraph(), diagnostics: [disabled()], completionEnabled: false };
    if (!force && graphCache && graphCache.expires > Date.now()) return cachedResponse();
    if (!force && !strict && graphCache) {
      void refreshGraph().catch(() => undefined);
      return cachedResponse();
    }
    try { return await refreshGraph(force); }
    catch (error) {
      if (strict) throw error;
      return cachedResponse();
    }
  }
  function assertPageSource(page: RawPage, sourceId: string, id?: string) {
    if ((id && !same(page.id, id)) || page.parent.type !== "data_source_id" || !page.parent.data_source_id || !same(page.parent.data_source_id, sourceId)) throw new AppError("TASK_NOT_FOUND", "Notion did not return the requested page in the configured data source.", 404);
  }
  async function scopedPage(id: string, schema: ResolvedSchema) {
    if (!uuid.safeParse(id).success) throw new AppError("INVALID_TASK_ID", "Use a valid Notion task ID.");
    const page = pageSchema.parse(await call(`pages/${id}`, "get", "task.read"));
    assertPageSource(page, schema.sources.tasks.id, id);
    if (page.parent.type !== "data_source_id" || !page.parent.data_source_id || !same(page.parent.data_source_id, schema.sources.tasks.id) || !activePage(page)) throw new AppError("TASK_NOT_FOUND", "This page is not an active task in your configured Tasks data source.", 404);
    return page;
  }
  function validateRelations(input: TaskInput, graph: Graph) {
    const area = graph.areas.find(area => same(area.id, input.areaId));
    const project = graph.projects.find(project => same(project.id, input.projectId));
    if (!area || !project) throw new AppError("RELATION_UNAVAILABLE", "Choose an available area and project.", 422);
    if (!project.areaIds.some(id => same(id, area.id))) throw new AppError("RELATION_CONFLICT", `Project “${project.name}” does not belong to area “${area.name}”.`, 422);
  }
  function writeProperties(input: TaskInput, schema: ResolvedSchema): Record<string, unknown> {
    const f = schema.fields;
    if (input.dates.end && !input.dates.start) throw new AppError("NOTION_DATE", "A deadline needs a start date in Notion. Choose a start date, or clear both dates.", 422);
    return { [f.taskTitle.id]: { title: [{ type: "text", text: { content: input.title } }] }, [f.taskDate.id]: { date: input.dates.start || input.dates.end ? { start: input.dates.start || input.dates.end, end: input.dates.start && input.dates.end ? input.dates.end : null } : null }, [f.taskArea.id]: { relation: [{ id: input.areaId }] }, [f.taskProject.id]: { relation: [{ id: input.projectId }] }, [f.taskHighlight.id]: { checkbox: input.highlight || false } };
  }
  function completionProperties(done: boolean, schema: ResolvedSchema): Record<string, unknown> {
    const c = schema.public.completion;
    if (!c?.enabled) throw new AppError("COMPLETION_DISABLED", "Choose a valid completion property and status values in Settings.", 422);
    const property = schema.sources.tasks.properties.find(prop => prop.name === c.property)!;
    return { [property.id]: c.type === "checkbox" ? { checkbox: done } : { status: { name: done ? c.completedValue : c.reopenValue } } };
  }
  function persistCachedGraph() {
    if (graphCache) {
      const { expires: _expires, ...snapshot } = graphCache;
      try { options.persistGraphSnapshot?.(snapshot); } catch { console.error("Could not persist the Notion graph snapshot."); }
    }
  }
  function patchCachedTask(taskId: string, task?: Task) {
    graphGeneration += 1;
    if (!graphCache) return;
    const previousGraph = graphCache.response.graph;
    const tasks = graphCache.response.graph.tasks.filter(item => !same(item.id, taskId));
    if (task) tasks.push(task);
    const response = { ...graphCache.response, graph: { ...previousGraph, tasks, syncedAt: revisionAfter(previousGraph.syncedAt) } };
    const history = appendGraphHistory(graphCache.history ?? [], previousGraph, response.graph);
    graphCache = { ...graphCache, response, history, expires: Date.now() + 60_000 };
    persistCachedGraph();
  }
  function invalidate(schema = false) { graphGeneration += 1; if (graphCache) graphCache.expires = 0; if (schema) { schemaGeneration += 1; if (schemaCache) schemaCache.expires = 0; } }
  async function createTask(input: TaskInput): Promise<Task> {
    const validated = taskInputSchema.parse(input);
    const { graph } = await readGraph(false, true);
    const schema = await resolveSchema();
    validateRelations(validated, graph);
    const properties = writeProperties(validated, schema);
    if (schema.public.completion?.enabled) Object.assign(properties, completionProperties(false, schema));
    let createdId: string | null = null;
    try {
      const raw = await call("pages", "post", "task.create", { parent: { type: "data_source_id", data_source_id: schema.sources.tasks.id }, properties });
      const identity = z.object({ id: uuid }).safeParse(raw);
      createdId = identity.success ? identity.data.id : null;
      const page = pageSchema.parse(raw);
      assertPageSource(page, schema.sources.tasks.id);
      if (!activePage(page)) throw new AppError("NOTION_WRITE_OUTCOME", "The created task is unexpectedly archived or in the trash.", 502);
      const task = await mapTask(page, schema);
      patchCachedTask(task.id, task);
      return task;
    } catch (error) {
      invalidate();
      if (createdId) throw new AppError("NOTION_WRITE_OUTCOME", `Task ${createdId} was created, but its response could not be read. Refresh Notion before trying again.`, 502, { source: "notion", operation: "task.create", taskId: createdId });
      throw notionError(error, "task.create");
    }
  }
  async function getTask(id: string): Promise<Task> {
    try { const schema = await resolveSchema(); return await mapTask(await scopedPage(id, schema), schema); }
    catch (error) { throw notionError(error, "task.read"); }
  }
  /** A cache or an absent/ambiguous completion property cannot authorize push. */
  async function isReminderTaskOpen(id: string): Promise<boolean> {
    try {
      const schema = await resolveSchema(true);
      const completion = schema.public.completion;
      if (!completion?.enabled) throw new AppError("PUSH_COMPLETION_UNKNOWN", "Push needs a verified completion mapping.", 422);
      const page = await scopedPage(id, schema);
      if (completion.type === "status") {
        const raw = z.object({ type: z.literal("status"), status: z.object({ name: z.string() }) }).parse(page.properties[completion.property]);
        const property = schema.public.properties.tasks.find(item => item.name === completion.property);
        if (!property?.options.some(option => option.name === raw.status.name)) throw new AppError("PUSH_COMPLETION_UNKNOWN", "The task completion status is unavailable.", 422);
      } else z.object({ type: z.literal("checkbox"), checkbox: z.boolean() }).parse(page.properties[completion.property]);
      return !completed(page, schema);
    } catch (error) { throw notionError(error, "reminder.status"); }
  }
  async function updateTask(id: string, patch: TaskPatch): Promise<Task> {
    const { graph } = await readGraph(false, true);
    const schema = await resolveSchema();
    const current = await mapTask(await scopedPage(id, schema), schema);
    const properties: Record<string, unknown> = {};
    if (!patch.task) validateRelations(taskInputSchema.parse({ title: current.title, areaId: current.areaId, projectId: current.projectId, dates: current.dates, highlight: current.highlight }), graph);
    if (patch.task) {
      const input = taskInputSchema.parse({ title: current.title, areaId: current.areaId, projectId: current.projectId, dates: current.dates, highlight: current.highlight, ...patch.task });
      validateRelations(input, graph);
      // Send only changed properties so completion/date/title edits cannot overwrite unrelated remote changes.
      const all = writeProperties(input, schema);
      const ids = { title: schema.fields.taskTitle.id, dates: schema.fields.taskDate.id, areaId: schema.fields.taskArea.id, projectId: schema.fields.taskProject.id, highlight: schema.fields.taskHighlight.id };
      for (const field of Object.keys(patch.task) as (keyof typeof ids)[]) properties[ids[field]] = all[ids[field]];
    }
    if (patch.completed !== undefined) Object.assign(properties, completionProperties(patch.completed, schema));
    try {
      const page = pageSchema.parse(await call(`pages/${id}`, "patch", "task.update", { properties }));
      assertPageSource(page, schema.sources.tasks.id, id);
      if (!activePage(page)) throw new AppError("NOTION_WRITE_OUTCOME", "The updated task is unexpectedly archived or in the trash.", 502);
      const task = await mapTask(page, schema);
      patchCachedTask(task.id, task);
      return task;
    }
    catch (error) { invalidate(); throw notionError(error, "task.update"); }
  }
  async function deleteTask(id: string) {
    const schema = await resolveSchema();
    await scopedPage(id, schema);
    try {
      const result = z.object({ object: z.literal("page"), id: uuid, in_trash: z.literal(true) }).parse(await call(`pages/${id}`, "patch", "task.delete", { in_trash: true }));
      if (!same(result.id, id)) throw new AppError("NOTION_WRITE_OUTCOME", "Notion did not confirm trashing the requested task. Refresh and inspect it before retrying.", 502);
      patchCachedTask(id);
    }
    catch (error) { invalidate(); throw notionError(error, "task.delete"); }
    return { deleted: true };
  }
  async function readGraphSync(since?: string | null, waitForRefresh = false): Promise<NotionGraphSyncResponse> {
    const response = waitForRefresh ? await refreshGraph() : await readGraph();
    if (!since || !graphCache || !response.graph.syncedAt) return { mode: "snapshot", response };
    const currentRevision = graphCache.response.graph.syncedAt;
    if (since === currentRevision) return { mode: "delta", revision: currentRevision, areas: [], projects: [], tasks: [], deletedAreaIds: [], deletedProjectIds: [], deletedTaskIds: [], diagnostics: response.diagnostics, completionEnabled: response.completionEnabled };
    const history = graphCache.history ?? [];
    const changes: Omit<NotionGraphDelta, "fromRevision" | "revision"> = { areas: [], projects: [], tasks: [], deletedAreaIds: [], deletedProjectIds: [], deletedTaskIds: [] };
    const upserts = { areas: new Map<string, Area>(), projects: new Map<string, Project>(), tasks: new Map<string, Task>() };
    const removed = { areas: new Set<string>(), projects: new Set<string>(), tasks: new Set<string>() };
    const applyEvent = <T extends { id: string }>(items: Map<string, T>, deletedIds: Set<string>, updates: T[], deletions: string[]) => {
      for (const id of deletions) { items.delete(key(id)); deletedIds.add(id); }
      for (const item of updates) { items.set(key(item.id), item); for (const id of [...deletedIds]) if (same(id, item.id)) deletedIds.delete(id); }
    };
    let cursor = since;
    for (const change of history) {
      if (change.fromRevision !== cursor) continue;
      applyEvent(upserts.areas, removed.areas, change.areas, change.deletedAreaIds);
      applyEvent(upserts.projects, removed.projects, change.projects, change.deletedProjectIds);
      applyEvent(upserts.tasks, removed.tasks, change.tasks, change.deletedTaskIds);
      cursor = change.revision;
      if (cursor === currentRevision) break;
    }
    if (cursor !== currentRevision) return { mode: "snapshot", response };
    changes.areas = [...upserts.areas.values()]; changes.projects = [...upserts.projects.values()]; changes.tasks = [...upserts.tasks.values()];
    changes.deletedAreaIds = [...removed.areas]; changes.deletedProjectIds = [...removed.projects]; changes.deletedTaskIds = [...removed.tasks];
    return { mode: "delta", revision: currentRevision, ...changes, diagnostics: response.diagnostics, completionEnabled: response.completionEnabled };
  }
  function getCachedGraph() { return graphCache?.response; }
  return { readGraph, readGraphSync, refreshGraph, getCachedGraph, publicSchema, createTask, getTask, isReminderTaskOpen, updateTask, deleteTask, invalidate };
}
