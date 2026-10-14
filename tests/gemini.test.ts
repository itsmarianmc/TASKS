import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ create: vi.fn(), constructor: vi.fn() }));
vi.mock("@google/genai", () => ({ GoogleGenAI: class {
  interactions = { create: sdk.create };
  constructor(options: unknown) { sdk.constructor(options); }
} }));
import { parseQuickAdd } from "@/lib/parser";
import { publicConfig } from "@/lib/server/config";
import { geminiConfig, geminiStatus } from "@/lib/server/ai/config";
import { geminiPayload, parseWithGemini, validateGeminiResult, type TaskParseInput } from "@/lib/server/ai/gemini";
import { parseTaskCapture } from "@/lib/server/ai/fallback";
import { GET as status } from "@/app/api/ai/status/route";
import type { Graph, ParserAlias } from "@/lib/types";

const graph: Graph = { tasks: [], syncedAt: null,
  areas: [ { id: "homework", name: "Hausaufgaben", type: null, url: "", projectIds: ["english", "physics", "history"] }, { id: "web", name: "Web Development", type: null, url: "", projectIds: ["taesks"] } ],
  projects: [ ["english", "Englisch", "homework"], ["physics", "Physik", "homework"], ["history", "Geschichte", "homework"], ["taesks", "TÆSKS", "web"] ].map(([id, name, areaId]) => ({ id, name, areaIds: [areaId], status: null, priority: null, dates: { start: null, end: null }, url: "" })) };
const aliases: ParserAlias[] = [
  { id: "a1", entityType: "project", entityId: "english", alias: "English" },
  { id: "a2", entityType: "project", entityId: "physics", alias: "Physics" },
  { id: "a3", entityType: "area", entityId: "homework", alias: "Homework" },
  { id: "a4", entityType: "area", entityId: "homework", alias: "Hausaufgabe" },
];
const context = { today: "2026-10-04", timezone: "Europe/Berlin" };
const output = { title: "Finish presentation", projectId: "english", areaId: "homework", dates: { start: context.today, end: "2026-10-05" }, tags: [], priority: "none", recurrenceRule: null, confidence: 0.93 };
function input(text = "Need to finish that presentation for homework before school on Monday", patch: Partial<TaskParseInput> = {}): TaskParseInput {
  return { input: text, graph, aliases, tags: [], context, deterministic: parseQuickAdd(text, graph, aliases, context), ...patch };
}
const config = { apiKey: "test-secret-never-expose", model: "gemini-3.5-flash-lite", enabled: true, timeoutMs: 5000, confidenceThreshold: 0.75 };
function respond(value: unknown = output) { sdk.create.mockResolvedValue({ status: "completed", output_text: JSON.stringify(value) }); }
beforeEach(() => {
  sdk.create.mockReset(); sdk.constructor.mockClear(); respond();
  vi.stubEnv("GEMINI_API_KEY", config.apiKey); vi.stubEnv("GEMINI_FALLBACK_ENABLED", "true");
  vi.stubEnv("GEMINI_MODEL", ""); vi.stubEnv("GEMINI_TIMEOUT_MS", ""); vi.stubEnv("GEMINI_CONFIDENCE_THRESHOLD", "");
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Gemini structured adapter trust boundary", () => {
  it("round-trips a mocked HTTP response through the real installed SDK without live requests", async () => {
    const actual = await vi.importActual<typeof import("@google/genai")>("@google/genai");
    const transport = vi.fn().mockResolvedValue(Response.json({ id: "test-interaction", status: "completed", model: config.model,
      object: "interaction", steps: [], output_text: JSON.stringify(output) }));
    vi.stubGlobal("fetch", transport);
    const client = new actual.GoogleGenAI({ apiKey: config.apiKey, vertexai: false });
    expect(await parseWithGemini(input(), config, undefined, client)).toMatchObject({ valid: true, title: output.title });
    expect(transport).toHaveBeenCalledTimes(1);
    const request = transport.mock.calls[0][0] as Request;
    expect(request.url).toContain("/interactions");
    const body = await request.clone().json();
    expect(body).toMatchObject({ model: config.model, store: false, response_format: { mime_type: "application/json" } });
  });
  it("the real SDK does not retry HTTP 429 and exposes only a sanitized error", async () => {
    const actual = await vi.importActual<typeof import("@google/genai")>("@google/genai");
    const transport = vi.fn().mockResolvedValue(Response.json({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: config.apiKey } }, { status: 429 }));
    vi.stubGlobal("fetch", transport);
    const client = new actual.GoogleGenAI({ apiKey: config.apiKey, vertexai: false });
    await expect(parseWithGemini(input(), config, undefined, client)).rejects.toMatchObject({ reason: "rate_limit", message: "Couldn't infer all fields." });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(config.apiKey);
  });
  it("uses the official stateless Interactions API with constrained JSON and no tools or retries", async () => {
    const result = await parseWithGemini(input(), config);
    expect(result).toMatchObject({ ...output, valid: true, needsResolution: false });
    expect(sdk.constructor).toHaveBeenCalledWith({ apiKey: config.apiKey, vertexai: false });
    const [request, options] = sdk.create.mock.calls[0];
    expect(request).toMatchObject({ model: config.model, store: false, stream: false, tools: [], response_format: { type: "text", mime_type: "application/json", schema: { additionalProperties: false } } });
    expect(options).toMatchObject({ timeout_ms: 5000, retries: { strategy: "none" }, signal: expect.any(AbortSignal) });
    expect(request).not.toHaveProperty("generation_config");
    expect(request.response_format.schema.properties.projectId.anyOf[0].enum).toEqual(["english", "physics", "history", "taesks"]);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"success":true'));
    expect(JSON.stringify(request) + JSON.stringify(result) + JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(config.apiKey);
  });
  it.each([
    ["schema mismatch", { ...output, title: 12 }],
    ["empty title", { ...output, title: " " }],
    ["unknown project", { ...output, projectId: "chemistry" }],
    ["unknown area", { ...output, areaId: "made-up" }],
    ["invalid relation", { ...output, areaId: "web" }],
    ["invalid calendar date", { ...output, dates: { start: context.today, end: "2026-02-30" } }],
    ["unsupported calendar year", { ...output, dates: { start: "0000-01-01", end: "0000-01-02" } }],
    ["reversed dates", { ...output, dates: { start: context.today, end: "2026-10-01" } }],
    ["wrong single-date start", { ...output, dates: { start: "2026-10-05", end: "2026-10-05" } }],
    ["low confidence", { ...output, confidence: 0.74 }],
    ["unknown tag", { ...output, tags: ["invented"] }],
    ["extra untrusted field", { ...output, secret: "untrusted" }],
  ])("rejects %s", async (_label, value) => {
    respond(value); await expect(parseWithGemini(input(), config)).rejects.toMatchObject({ reason: "invalid_result", message: "Couldn't infer all fields." });
  });
  it.each(["not JSON", "```json\n{}\n```", "", undefined])("rejects invalid or missing JSON: %s", async text => {
    sdk.create.mockResolvedValue({ status: "completed", output_text: text });
    await expect(parseWithGemini(input(), config)).rejects.toMatchObject({ reason: "invalid_result" });
  });
  it("rejects an incomplete interaction even when its text looks valid", async () => {
    sdk.create.mockResolvedValue({ status: "incomplete", output_text: JSON.stringify(output) });
    await expect(parseWithGemini(input(), config)).rejects.toMatchObject({ reason: "invalid_result" });
  });
  it("aborts at the configured deadline, even when a transport never settles", async () => {
    vi.useFakeTimers(); sdk.create.mockImplementation(() => new Promise(() => {}));
    const promise = parseWithGemini(input(), config);
    const assertion = expect(promise).rejects.toMatchObject({ reason: "timeout" });
    await vi.advanceTimersByTimeAsync(5000); await assertion;
    expect(sdk.create.mock.calls[0][1].signal.aborted).toBe(true);
    expect(sdk.create).toHaveBeenCalledTimes(1);
  });
  it.each([[429, "rate_limit"], [503, "upstream"], [404, "network"], [undefined, "network"]])("sanitizes status %s without retries", async (status, reason) => {
    sdk.create.mockRejectedValue({ status, message: `upstream echoes ${config.apiKey}` });
    await expect(parseWithGemini(input(), config)).rejects.toMatchObject({ reason, message: "Couldn't infer all fields." });
    expect(sdk.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(config.apiKey);
  });
  it("retains null relations as unresolved preview fields", async () => {
    respond({ ...output, projectId: null });
    expect(await parseWithGemini(input(), config)).toMatchObject({ projectId: null, valid: false, needsResolution: true, warnings: ["Choose a project."] });
  });
  it("only sends parsing metadata, aliases, valid pairs and local calendar context", () => {
    const enriched = input(); enriched.graph = { ...graph, tasks: [{ id: "private-task", title: "PRIVATE TASK HISTORY" } as Graph["tasks"][number]] };
    const payload = geminiPayload(enriched);
    expect(payload).toMatchObject({ currentDate: context.today, timezone: "Europe/Berlin", allowedProjects: [expect.objectContaining({ aliases: ["English"] }), expect.anything(), expect.anything(), expect.anything()], validContexts: expect.arrayContaining([{ projectId: "english", areaId: "homework" }]) });
    expect(JSON.stringify(payload)).not.toContain("PRIVATE TASK HISTORY"); expect(payload).not.toHaveProperty("tasks");
  });
  it("preserves current view defaults unless deterministic matching finds an explicit alternative", () => {
    const value = input("Prepare slides before school on Monday", { context: { ...context, projectId: "english", areaId: "homework" } });
    value.deterministic = parseQuickAdd(value.input, graph, aliases, value.context);
    expect(() => validateGeminiResult(JSON.stringify({ ...output, projectId: "physics" }), value, 0.75)).toThrow();
    expect(validateGeminiResult(JSON.stringify(output), value, 0.75).projectId).toBe("english");
    const explicit = input("Prepare slides in Physics before school on Monday", { context: value.context });
    explicit.deterministic = parseQuickAdd(explicit.input, graph, aliases, explicit.context);
    expect(validateGeminiResult(JSON.stringify({ ...output, projectId: "physics" }), explicit, 0.75).projectId).toBe("physics");
  });
  it("accepts any supplied valid multi-area context without inventing a pair", () => {
    const multiGraph = { ...graph, projects: graph.projects.map(project => project.id === "english" ? { ...project, areaIds: ["homework", "web"] } : project) };
    const value = input("Prepare slides #English before school on Monday", { graph: multiGraph });
    value.deterministic = parseQuickAdd(value.input, multiGraph, aliases, context);
    expect(validateGeminiResult(JSON.stringify({ ...output, areaId: "web" }), value, 0.75).areaId).toBe("web");
  });
  it("retains deterministic dates, explicit tags, priority and recurrence", () => {
    const value = input("Finish English before school on Monday [new tag] !! every 2 weeks");
    const valid = { ...output, tags: ["new tag"], priority: "high", recurrenceRule: { frequency: "week", interval: 2 } };
    expect(validateGeminiResult(JSON.stringify(valid), value, 0.75)).toMatchObject(valid);
    for (const patch of [{ tags: [] }, { priority: "none" }, { recurrenceRule: null }, { dates: { start: context.today, end: "2026-10-06" } }])
      expect(() => validateGeminiResult(JSON.stringify({ ...valid, ...patch }), value, 0.75)).toThrow();
  });
  it("never silently repairs an explicit invalid date or relation", () => {
    for (const text of ["Finish English until 31.02.2026", "Finish #English @WebDevelopment before school on Monday"]) {
      expect(() => validateGeminiResult(JSON.stringify(output), input(text), 0.75)).toThrow();
    }
  });
});

describe("rules first, AI last", () => {
  it.each([
    "Make Presentation in English as Homework until Friday",
    "Präsentation in Englisch als Hausaufgabe bis Freitag",
    "Physics homework tomorrow", "Physik Hausaufgabe morgen",
    "Geschichte Präsentation bis 10.10.", "Fix API in TÆSKS until next Monday",
    "Study physics from Monday to Friday", "Physik lernen von Montag bis Freitag",
    "Make presentation in Englisch als Hausaufgabe bis Freitag", "Physics Hausaufgabe tomorrow",
    "Presentation in English by Friday", "Presentation in English until 10/11/2026",
  ])("resolves %s without constructing Gemini", async text => {
    const response = await parseTaskCapture(text, graph, aliases, context, []);
    expect(response).toMatchObject({ fallback: "not needed", result: { valid: true } });
    expect(sdk.create).not.toHaveBeenCalled(); expect(sdk.constructor).not.toHaveBeenCalled();
  });
  it("calls Gemini once for a complex temporal phrase and returns only a validated preview", async () => {
    const text = "Need to finally get that English presentation for homework finished before school on Monday";
    expect(parseQuickAdd(text, graph, aliases, context).confidence).toBeLessThan(0.75);
    const response = await parseTaskCapture(text, graph, aliases, context, []);
    expect(response).toMatchObject({ fallback: "accepted", result: { title: output.title, valid: true } });
    expect(sdk.create).toHaveBeenCalledTimes(1);
  });
  it("keeps the exact partial deterministic result on AI failure", async () => {
    const value = input(); sdk.create.mockRejectedValue(new Error("timeout with secret"));
    expect(await parseTaskCapture(value.input, graph, aliases, context, [])).toEqual({ result: value.deterministic, fallback: "failed" });
  });
  it("retains deterministic results on timeout and rate limiting", async () => {
    const value = input();
    vi.useFakeTimers(); sdk.create.mockImplementation(() => new Promise(() => {}));
    const pending = parseTaskCapture(value.input, graph, aliases, context, []);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ result: value.deterministic, fallback: "failed" });
    sdk.create.mockRejectedValue({ status: 429 });
    expect(await parseTaskCapture(value.input, graph, aliases, context, [])).toEqual({ result: value.deterministic, fallback: "failed" });
  });
  it("rejects hallucinated results without returning them to the preview", async () => {
    const value = input(); respond({ ...output, projectId: "chemistry" });
    expect(await parseTaskCapture(value.input, graph, aliases, context, [])).toEqual({ result: value.deterministic, fallback: "failed" });
  });
  it.each(["missing key", "disabled", "empty graph", "cancelled", "empty input"])("remains functional with %s", async condition => {
    const value = input(); const controller = new AbortController();
    if (condition === "missing key") vi.stubEnv("GEMINI_API_KEY", "");
    if (condition === "disabled") vi.stubEnv("GEMINI_FALLBACK_ENABLED", "false");
    if (condition === "empty graph") value.graph = { tasks: [], areas: [], projects: [], syncedAt: null };
    if (condition === "cancelled") controller.abort();
    const response = await parseTaskCapture(condition === "empty input" ? "" : value.input, value.graph, aliases, context, [], controller.signal);
    expect(response.fallback).toBe("unavailable"); expect(sdk.create).not.toHaveBeenCalled(); expect(sdk.constructor).not.toHaveBeenCalled();
  });
  it("keeps Friday, German/English ranges and European numeric dates intact", async () => {
    for (const [text, start, end] of [["Presentation in English by Friday", context.today, "2026-10-09"], ["Study physics from Monday to Friday", "2026-10-05", "2026-10-09"], ["Physik lernen von Montag bis Freitag", "2026-10-05", "2026-10-09"], ["Presentation in English until 10/11/2026", context.today, "2026-11-10"]]) {
      expect((await parseTaskCapture(text, graph, aliases, context, [])).result.dates).toEqual({ start, end });
    }
  });
});

describe("optional server configuration and safe diagnostics", () => {
  it("has the required defaults and exposes no credential", async () => {
    expect(geminiConfig()).toEqual(config);
    expect(geminiStatus()).toMatchObject({ provider: "Gemini", model: config.model, status: "ready", enabled: true });
    for (const result of [publicConfig(), await status().json()]) expect(JSON.stringify(result)).not.toContain(config.apiKey);
  });
  it("works without a key, and validates numeric configuration conservatively", () => {
    vi.stubEnv("GEMINI_API_KEY", ""); vi.stubEnv("GEMINI_TIMEOUT_MS", "bad"); vi.stubEnv("GEMINI_CONFIDENCE_THRESHOLD", "2");
    expect(geminiConfig()).toMatchObject({ timeoutMs: 5000, confidenceThreshold: 0.75 });
    expect(geminiStatus()).toMatchObject({ status: "not configured", enabled: false });
    vi.stubEnv("GEMINI_FALLBACK_ENABLED", "false"); expect(geminiStatus().status).toBe("disabled");
  });
});
