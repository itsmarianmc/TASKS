import { describe, expect, it, vi } from "vitest";
import { createNotionAdapter, notionConfig, NOTION_API_VERSION, type NotionTransport } from "@/lib/server/notion";
import type { TaskInput } from "@/lib/types";

export const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const db = { tasks: id(1), projects: id(2), areas: id(3) };
const ds = { tasks: id(11), projects: id(12), areas: id(13) };
const prop = (name: string, type: string, extra = {}) => ({ id: name, name, type, ...extra });
const relation = (target: "areas" | "projects") => ({ relation: { database_id: db[target], data_source_id: ds[target] } });
export function fixture() {
  const config = notionConfig({}, { NOTION_TOKEN: "secret-test-token", NOTION_TASKS_DATABASE_ID: db.tasks, NOTION_PROJECTS_DATABASE_ID: db.projects, NOTION_AREAS_DATABASE_ID: db.areas });
  const schemas = {
    tasks: { Name: prop("Name", "title"), "Due Date": prop("Due Date", "date"), Area: prop("Area", "relation", relation("areas")), Project: prop("Project", "relation", relation("projects")), Highlight: prop("Highlight", "checkbox"), Done: prop("Done", "checkbox") },
    projects: { Name: prop("Name", "title"), Areas: prop("Areas", "relation", relation("areas")), Status: prop("Status", "select"), Priority: prop("Priority", "select"), Deadline: prop("Deadline", "date") },
    areas: { Name: prop("Name", "title"), Type: prop("Type", "select") },
  } as Record<"tasks" | "projects" | "areas", Record<string, ReturnType<typeof prop>>>;
  const makePage = (pageId: string, source: "tasks" | "projects" | "areas", properties: Record<string, unknown>) => ({ object: "page", id: pageId, parent: { type: "data_source_id", data_source_id: ds[source] }, in_trash: false, url: `https://notion.so/${pageId}`, created_time: "2026-10-01T12:00:00Z", last_edited_time: "2026-10-03T12:00:00Z", properties });
  const text = (value: string) => ({ type: "title", title: [{ plain_text: value }] });
  const pages = {
    areas: [makePage(id(103), "areas", { Name: text("Homework"), Type: { type: "select", select: { name: "Personal" } } })],
    projects: [makePage(id(102), "projects", { Name: text("English"), Areas: { type: "relation", relation: [{ id: id(103) }], has_more: false }, Status: { type: "select", select: { name: "In Progress" } }, Priority: { type: "select", select: { name: "High" } }, Deadline: { type: "date", date: null } })],
    tasks: [makePage(id(101), "tasks", { Name: text("Presentation"), "Due Date": { type: "date", date: { start: "2026-10-03", end: "2026-10-18" } }, Area: { type: "relation", relation: [{ id: id(103) }], has_more: false }, Project: { type: "relation", relation: [{ id: id(102) }], has_more: false }, Highlight: { type: "checkbox", checkbox: false }, Done: { type: "checkbox", checkbox: false } })],
  };
  let failure = false;
  let sequence = 200;
  const calls: Parameters<NotionTransport["request"]>[0][] = [];
  const request = vi.fn(async (input: Parameters<NotionTransport["request"]>[0]): Promise<unknown> => {
    calls.push(input);
    if (failure) throw { status: 503, message: "secret-test-token must never leak" };
    const [endpoint, target, action] = input.path.split("/");
    if (endpoint === "databases") {
      const source = (Object.keys(db) as (keyof typeof db)[]).find(source => db[source] === target)!;
      return { data_sources: [{ id: ds[source], name: source }], in_trash: false };
    }
    if (endpoint === "data_sources") {
      const source = (Object.keys(ds) as (keyof typeof ds)[]).find(source => ds[source] === target)!;
      if (action === "query") return { results: pages[source], has_more: false, next_cursor: null };
      return { object: "data_source", id: target, properties: schemas[source], in_trash: false };
    }
    if (endpoint === "pages") {
      if (input.method === "post") {
        const properties = input.body!.properties as Record<string, Record<string, unknown>>;
        const mapped: Record<string, unknown> = {};
        for (const [propertyName, value] of Object.entries(properties)) {
          const property = Object.values(schemas.tasks).find(property => property.id === propertyName)!;
          mapped[property.name] = { type: property.type, ...value, ...(property.type === "title" ? { title: (value.title as { text: { content: string } }[]).map(text => ({ plain_text: text.text.content })) } : {}) };
        }
        if (!mapped.Done && schemas.tasks.Done) mapped.Done = { type: "checkbox", checkbox: false };
        const page = makePage(id(++sequence), "tasks", mapped); pages.tasks.push(page); return page;
      }
      const page = [...pages.tasks, ...pages.projects, ...pages.areas].find(page => page.id === target);
      if (!page) throw { status: 404 };
      if (input.method === "patch") {
        if (input.body?.in_trash) page.in_trash = true;
        for (const [propertyId, value] of Object.entries(input.body?.properties as Record<string, object> || {})) {
          const property = Object.values(schemas.tasks).find(property => property.id === propertyId)!;
          const typed = value as Record<string, unknown>;
          page.properties[property.name] = { type: property.type, ...typed, ...(property.type === "title" ? { title: (typed.title as { text: { content: string } }[]).map(text => ({ plain_text: text.text.content })) } : {}) };
        }
      }
      return page;
    }
    throw new Error(`Unexpected mock endpoint ${input.path}`);
  });
  const transport = { request };
  const input: TaskInput = { title: "New task", areaId: id(103), projectId: id(102), dates: { start: "2026-10-03", end: "2026-10-18" }, highlight: true };
  return { config, schemas, pages, calls, request, transport, input, adapter: createNotionAdapter(config, transport), fail: () => { failure = true; }, recover: () => { failure = false; }, ds, db, makePage };
}
describe("Notion data source adapter", () => {
  it("startup waits for an incremental sync instead of confirming the fresh cache", async () => {
    const f = fixture();
    let hold = false;
    let release!: () => void;
    let started!: () => void;
    const captured = new Promise<void>(resolve => { started = resolve; });
    const adapter = createNotionAdapter(f.config, { request: async input => {
      if (hold && input.path === `data_sources/${ds.tasks}/query`) {
        started();
        await new Promise<void>(resolve => { release = resolve; });
      }
      return f.request(input);
    } });
    const initial = await adapter.readGraph();
    f.pages.tasks[0].properties.Done = { type: "checkbox", checkbox: true };
    const before = f.calls.length;
    hold = true;
    let settled = false;
    const refresh = adapter.readGraphSync(initial.graph.syncedAt, true).then(result => { settled = true; return result; });
    await captured;
    expect(settled).toBe(false);
    expect(adapter.getCachedGraph()?.graph.tasks[0].completed).toBe(false);
    release();
    const result = await refresh;
    expect(result.mode).toBe("delta");
    if (result.mode === "delta") expect(result.tasks[0].completed).toBe(true);
    const reads = f.calls.slice(before);
    expect(reads).toHaveLength(3);
    expect(reads.every(call => !!call.body?.filter)).toBe(true);
    hold = false;
    f.fail();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(adapter.readGraphSync(result.mode === "delta" ? result.revision : null, true)).rejects.toThrow();
    log.mockRestore();
    expect(adapter.getCachedGraph()?.graph.tasks[0].completed).toBe(true);
    expect((await adapter.readGraph()).diagnostics.some(value => value.status === "error")).toBe(true);
  });
  it("checks reminder completion directly and refuses stale or unknown task status", async () => {
    const f = fixture(); await f.adapter.readGraph();
    expect(await f.adapter.isReminderTaskOpen(id(101))).toBe(true);
    f.pages.tasks[0].properties.Done = { type: "checkbox", checkbox: true };
    expect(await f.adapter.isReminderTaskOpen(id(101))).toBe(false);
    f.fail(); await expect(f.adapter.isReminderTaskOpen(id(101))).rejects.toThrow(); f.recover();
    delete f.schemas.tasks.Done;
    await expect(f.adapter.isReminderTaskOpen(id(101))).rejects.toThrow();
  });
  it("never treats a missing task completion value as open for reminders", async () => {
    const f = fixture(); delete f.pages.tasks[0].properties.Done;
    await expect(f.adapter.isReminderTaskOpen(id(101))).rejects.toThrow();
  });
  it("refuses archived tasks for reminders", async () => {
    const f = fixture(); f.pages.tasks[0].in_trash = true;
    await expect(f.adapter.isReminderTaskOpen(id(101))).rejects.toThrow();
  });
  it("refuses null or unknown status values for reminders", async () => {
    const f = fixture(); delete f.schemas.tasks.Done;
    f.schemas.tasks.State = prop("State", "status", { status: { options: [{ id: "open", name: "Waiting" }, { id: "done", name: "Shipped" }], groups: [{ id: "g1", name: "To-do", option_ids: ["open"] }, { id: "g2", name: "Complete", option_ids: ["done"] }] } });
    f.pages.tasks[0].properties.State = { type: "status", status: { name: "Waiting" } };
    expect(await f.adapter.isReminderTaskOpen(id(101))).toBe(true);
    f.pages.tasks[0].properties.State = { type: "status", status: null };
    await expect(f.adapter.isReminderTaskOpen(id(101))).rejects.toThrow();
    f.pages.tasks[0].properties.State = { type: "status", status: { name: "Unavailable" } };
    await expect(f.adapter.isReminderTaskOpen(id(101))).rejects.toThrow();
  });
  it("does not reuse or cache a pre-delete graph read after invalidation", async () => {
    const f = fixture(); let hold = false; let release!: () => void; let started!: () => void;
    const captured = new Promise<void>(resolve => { started = resolve; });
    const transport: NotionTransport = { request: async input => {
      if (hold && input.path === `data_sources/${ds.tasks}/query`) {
        hold = false; const response = structuredClone(await f.request(input)); started();
        await new Promise<void>(resolve => { release = resolve; }); return response;
      }
      return f.request(input);
    } };
    const adapter = createNotionAdapter(f.config, transport); await adapter.readGraph(); hold = true;
    const old = adapter.readGraph(true); await captured;
    await adapter.deleteTask(id(101)); const fresh = await adapter.readGraph(); expect(fresh.graph.tasks).toEqual([]);
    release(); expect((await old).graph.tasks).toEqual([]); expect((await adapter.readGraph()).graph.tasks).toEqual([]);
    expect(f.calls.filter(call => call.path === `data_sources/${ds.tasks}/query`)).toHaveLength(3);
  });
  it("does not reuse a schema promise after mapping invalidation", async () => {
    const f = fixture(); let hold = true; let release!: () => void; let started!: () => void;
    const captured = new Promise<void>(resolve => { started = resolve; });
    const adapter = createNotionAdapter(f.config, { request: async input => {
      const response = structuredClone(await f.request(input));
      if (hold && input.path === `data_sources/${ds.tasks}`) { hold = false; started(); await new Promise<void>(resolve => { release = resolve; }); }
      return response;
    } });
    const old = adapter.publicSchema(); await captured;
    f.schemas.tasks.Reviewed = prop("Reviewed", "checkbox"); adapter.invalidate(true);
    const fresh = await adapter.publicSchema(); expect(fresh.completion).toBeNull(); release();
    expect((await old).completionCandidates).toEqual(["Done", "Reviewed"]);
    expect((await adapter.publicSchema()).completion).toBeNull();
  });
  it.each([{}, { object: "page", id: id(101), in_trash: false }, { object: "page", id: id(999), in_trash: true }])("never reports deletion from an unconfirmed successful response %#", async response => {
    const f = fixture(); const adapter = createNotionAdapter(f.config, { request: async input => input.method === "patch" ? response : f.request(input) });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(adapter.deleteTask(id(101))).rejects.toThrow(); log.mockRestore();
    expect((await adapter.readGraph()).graph.tasks).toHaveLength(1);
  });
  it.each(["get", "patch"] as const)("rejects a different valid task identity returned by scoped %s", async method => {
    const f = fixture(); const other = { ...f.pages.tasks[0], id: id(999) };
    const adapter = createNotionAdapter(f.config, { request: async input => input.path === `pages/${id(101)}` && input.method === method ? other : f.request(input) });
    await expect(method === "get" ? adapter.getTask(id(101)) : adapter.updateTask(id(101), { completed: true })).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });
    if (method === "get") expect(f.calls.some(call => call.method === "patch")).toBe(false);
  });
  it.each([{ id: "invalid" }, { url: "javascript:alert(1)" }, { url: "https://user:secret@example.com" }, { created_time: "invalid" }, { last_edited_time: "2026-02-30T12:00:00Z" }])("rejects malformed or unsafe normalized remote values %#", async patch => {
    const f = fixture(); Object.assign(f.pages.tasks[0], patch); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await f.adapter.readGraph(); expect(response.diagnostics[0].status).toBe("error"); expect(response.graph.tasks).toEqual([]); log.mockRestore();
  });
  it("retains a confirmed created ID when the remaining response is unsafe", async () => {
    const f = fixture(); const adapter = createNotionAdapter(f.config, { request: async input => input.path === "pages" ? { ...await f.request(input) as object, url: "javascript:alert(1)" } : f.request(input) });
    await expect(adapter.createTask(f.input)).rejects.toMatchObject({ code: "NOTION_WRITE_OUTCOME", details: { taskId: id(201), operation: "task.create" } });
  });
  it("canonicalizes UUID page and relation IDs and rejects a mismatched source identity", async () => {
    const f = fixture(); f.pages.tasks[0].id = id(101).replaceAll("-", "");
    expect((await f.adapter.readGraph()).graph.tasks[0].id).toBe(id(101));
    const wrong = createNotionAdapter(f.config, { request: async input => input.path === `data_sources/${ds.tasks}` ? { ...await f.request(input) as object, id: id(999) } : f.request(input) });
    expect((await wrong.readGraph()).diagnostics[0].message).toContain("different data source");
  });
  it("returns genuine empty data with explicit disabled diagnostics when unconfigured", async () => {
    const request = vi.fn();
    const adapter = createNotionAdapter(notionConfig({}, {}), { request });
    expect((await adapter.readGraph()).graph.tasks).toEqual([]);
    expect((await adapter.publicSchema()).diagnostics[0].status).toBe("disabled");
    await expect(adapter.createTask(fixture().input)).rejects.toMatchObject({ code: "NOTION_DISABLED" });
    expect(request).not.toHaveBeenCalled();
    expect(NOTION_API_VERSION).toBe("2026-03-11");
  });
  it("requires a data source selection for multi-source databases", async () => {
    const f = fixture();
    const transport = { request: vi.fn(async (input: Parameters<NotionTransport["request"]>[0]) => input.path === `databases/${db.tasks}` ? { data_sources: [{ id: ds.tasks, name: "Tasks" }, { id: id(19), name: "Other" }] } : f.request(input)) };
    const result = await createNotionAdapter(f.config, transport).readGraph();
    expect(result.diagnostics[0].message).toContain("NOTION_TASKS_DATA_SOURCE_ID");
    f.config.dataSources.tasks = ds.tasks;
    expect((await createNotionAdapter(f.config, transport).readGraph()).graph.tasks).toHaveLength(1);
  });
  it("validates missing fields and relation targets without changing schemas", async () => {
    const f = fixture(); delete f.schemas.tasks["Due Date"];
    const schema = await f.adapter.publicSchema();
    expect(schema.diagnostics[0].message).toContain("Due Date");
    expect(schema.properties.tasks.some(property => property.name === "Name")).toBe(true);
    expect(f.calls.every(call => call.method === "get")).toBe(true);
    const wrong = fixture(); wrong.schemas.tasks.Area = prop("Area", "relation", relation("projects"));
    expect((await wrong.adapter.readGraph()).diagnostics[0].message).toContain("relation target");
  });
  it("never uses Highlight for completion and requires ambiguous mapping", async () => {
    const f = fixture(); delete f.schemas.tasks.Done;
    let schema = await f.adapter.publicSchema();
    expect(schema.completion).toBeNull(); expect(schema.completionCandidates).toEqual([]);
    f.schemas.tasks.Done = prop("Done", "checkbox"); f.schemas.tasks.Reviewed = prop("Reviewed", "checkbox");
    schema = await f.adapter.publicSchema(true);
    expect(schema.completionCandidates).toHaveLength(2); expect(schema.completion).toBeNull();
    await expect(f.adapter.updateTask(id(101), { completed: true })).rejects.toMatchObject({ code: "COMPLETION_DISABLED" });
    expect(f.calls.filter(call => call.method === "patch")).toHaveLength(0);
  });
  it("uses status group membership for reads, chooses unambiguous values, and supports reopen", async () => {
    const f = fixture(); delete f.schemas.tasks.Done;
    f.schemas.tasks.State = prop("State", "status", { status: { options: [{ id: "open", name: "Waiting" }, { id: "done", name: "Shipped" }], groups: [{ id: "g1", name: "To-do", option_ids: ["open"] }, { id: "g2", name: "Complete", option_ids: ["done"] }] } });
    f.pages.tasks[0].properties.State = { type: "status", status: { name: "Waiting" } };
    expect((await f.adapter.publicSchema()).completion).toMatchObject({ enabled: true, completedValue: "Shipped", reopenValue: "Waiting" });
    expect((await f.adapter.updateTask(id(101), { completed: true })).completed).toBe(true);
    expect((await f.adapter.updateTask(id(101), { completed: false })).completed).toBe(false);
    const last = f.calls.filter(call => call.method === "patch").at(-1)!;
    expect(last.body?.properties).toEqual({ State: { status: { name: "Waiting" } } });
  });
  it("requires status mappings for several indistinguishable done/reopen options", async () => {
    const f = fixture(); delete f.schemas.tasks.Done;
    f.schemas.tasks.Status = prop("Status", "status", { status: { options: [{ id: "a", name: "Waiting A" }, { id: "b", name: "Waiting B" }, { id: "c", name: "Shipped A" }, { id: "d", name: "Shipped B" }], groups: [{ id: "g1", name: "To-do", option_ids: ["a", "b"] }, { id: "g2", name: "Complete", option_ids: ["c", "d"] }] } });
    const before = await f.adapter.publicSchema(); expect(before.completion?.enabled).toBe(false);
    f.config.mapping.completionValue = "Shipped A"; f.config.mapping.reopenValue = "Waiting A";
    expect((await createNotionAdapter(f.config, f.transport).publicSchema()).completion?.enabled).toBe(true);
    f.config.mapping.reopenValue = "Shipped B";
    expect((await createNotionAdapter(f.config, f.transport).publicSchema()).completion?.enabled).toBe(false);
  });
  it("infers unique title and project-area relation fields by their types and targets", async () => {
    const f = fixture(); f.schemas.projects.Subject = prop("Subject", "title"); delete f.schemas.projects.Name;
    f.pages.projects[0].properties.Subject = f.pages.projects[0].properties.Name;
    expect((await f.adapter.readGraph()).graph.projects[0].name).toBe("English");
  });
  it("loads every query page and every truncated relation property page", async () => {
    const f = fixture();
    const secondArea = f.makePage(id(104), "areas", { ...f.pages.areas[0].properties, Name: { type: "title", title: [{ plain_text: "Other area" }] } });
    f.pages.areas.push(secondArea);
    f.pages.projects[0].properties.Areas = { type: "relation", relation: [{ id: id(103) }], has_more: true };
    const secondTask = f.makePage(id(105), "tasks", { ...f.pages.tasks[0].properties });
    const transport: NotionTransport = { request: async input => {
      if (input.path === `pages/${id(102)}/properties/Areas`) return input.query?.start_cursor ? { results: [{ type: "relation", relation: { id: id(104) } }], has_more: false, next_cursor: null } : { results: [{ type: "relation", relation: { id: id(103) } }], has_more: true, next_cursor: "relation-next" };
      if (input.path === `data_sources/${ds.tasks}/query`) return input.body?.start_cursor ? { results: [secondTask], has_more: false, next_cursor: null } : { results: [f.pages.tasks[0]], has_more: true, next_cursor: "tasks-next" };
      return f.request(input);
    } };
    const { graph } = await createNotionAdapter(f.config, transport).readGraph();
    expect(graph.tasks).toHaveLength(2); expect(graph.projects[0].areaIds).toEqual([id(103), id(104)]);
    expect(graph.areas[1].projectIds).toContain(id(102));
  });
  it("preserves date-only calendar values and normalizes datetime offsets in app timezone", async () => {
    const f = fixture();
    f.pages.tasks[0].properties["Due Date"] = { type: "date", date: { start: "2026-10-02T23:30:00Z", end: "2026-10-18" } };
    expect((await f.adapter.readGraph()).graph.tasks[0].dates).toEqual({ start: "2026-10-03", end: "2026-10-18" });
  });
  it("roundtrips interval and empty dates, and rejects deadline without start before writing", async () => {
    const f = fixture();
    const created = await f.adapter.createTask(f.input); expect(created.dates).toEqual(f.input.dates);
    expect(f.calls.find(call => call.path === "pages")?.body?.parent).toEqual({ type: "data_source_id", data_source_id: ds.tasks });
    expect((await f.adapter.updateTask(created.id, { task: { dates: { start: null, end: null } } })).dates).toEqual({ start: null, end: null });
    await expect(f.adapter.createTask({ ...f.input, dates: { start: null, end: "2026-10-18" } })).rejects.toMatchObject({ code: "NOTION_DATE" });
    expect(f.calls.filter(call => call.path === "pages")).toHaveLength(1);
  });
  it("validates relations on the server and scopes edits/deletes to configured tasks", async () => {
    const f = fixture();
    await expect(f.adapter.createTask({ ...f.input, areaId: id(999) })).rejects.toMatchObject({ code: "RELATION_UNAVAILABLE" });
    f.pages.areas.push(f.makePage(id(104), "areas", { ...f.pages.areas[0].properties }));
    await expect(f.adapter.updateTask(id(101), { task: { areaId: id(104) } })).rejects.toMatchObject({ code: "RELATION_CONFLICT" });
    await expect(f.adapter.updateTask(id(102), { task: { title: "Unsafe" } })).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });
    await expect(f.adapter.deleteTask(id(102))).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });
    await f.adapter.updateTask(id(101), { task: { title: "Changed" } });
    expect(f.calls.filter(call => call.method === "patch").at(-1)?.body?.properties).toEqual({ Name: { title: [{ type: "text", text: { content: "Changed" } }] } });
    await f.adapter.deleteTask(id(101));
    expect(f.calls.at(-1)?.body).toEqual({ in_trash: true });
    expect((await f.adapter.readGraph()).graph.tasks).toHaveLength(0);
  });
  it("keeps explicitly stale graph after read failure and refuses writes using stale relations", async () => {
    const f = fixture(); const initial = await f.adapter.readGraph(); f.fail();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const stale = await f.adapter.readGraph(true);
    expect(stale.graph.syncedAt).toBe(initial.graph.syncedAt); expect(stale.diagnostics[0].status).toBe("error"); expect(stale.completionEnabled).toBe(false);
    expect(JSON.stringify(stale)).not.toContain("secret-test-token");
    await expect(f.adapter.createTask(f.input)).rejects.toMatchObject({ code: "NOTION_UNAVAILABLE" });
    expect(f.calls.filter(call => call.path === "pages")).toHaveLength(0);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-test-token"); log.mockRestore();
  });
  it("deduplicates concurrent reads and does not reload schema after ordinary task mutation", async () => {
    const f = fixture(); await Promise.all([f.adapter.readGraph(), f.adapter.readGraph(), f.adapter.publicSchema()]);
    expect(f.calls.filter(call => call.path.startsWith("databases/")).length).toBe(3);
    await f.adapter.updateTask(id(101), { completed: true }); await f.adapter.readGraph();
    expect(f.calls.filter(call => call.path.startsWith("databases/")).length).toBe(3);
  });
});
