import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const dependencies = vi.hoisted(() => ({ readGraph: vi.fn(), snapshot: vi.fn(), parse: vi.fn() }));
vi.mock("@/lib/server/notion-service", () => ({ notion: async () => ({ readGraph: dependencies.readGraph }) }));
vi.mock("@/lib/server/repository", () => ({ repository: () => ({ snapshot: dependencies.snapshot }) }));
vi.mock("@/lib/server/ai/fallback", () => ({ parseTaskCapture: dependencies.parse }));
import { POST } from "@/app/api/parse/route";
const graph = { areas: [], projects: [], tasks: [], syncedAt: null };
beforeEach(() => {
  vi.stubEnv("APP_ORIGIN", ""); vi.stubEnv("APP_TIMEZONE", "Europe/Berlin");
  dependencies.readGraph.mockReset().mockResolvedValue({ graph });
  dependencies.snapshot.mockReset().mockResolvedValue({ aliases: [], tags: [], notes: ["private"], drafts: [] });
  dependencies.parse.mockReset().mockResolvedValue({ result: { title: "Partial task", valid: false }, fallback: "unavailable" });
});
afterEach(() => vi.unstubAllEnvs());
function request(body: unknown, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/parse", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}
describe("explicit parsing endpoint", () => {
  it("uses authoritative relations and server timezone, returning a preview without mutations", async () => {
    const response = await POST(request({ input: "Partial task", context: { areaId: "homework" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ fallback: "unavailable", result: { valid: false } });
    expect(dependencies.parse).toHaveBeenCalledWith("Partial task", graph, [], { areaId: "homework", timezone: "Europe/Berlin" }, [], expect.any(AbortSignal));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("blocks cross-origin calls before reading app data or invoking a provider", async () => {
    expect((await POST(request({ input: "Task" }, "https://evil.example"))).status).toBe(403);
    expect(dependencies.readGraph).not.toHaveBeenCalled(); expect(dependencies.parse).not.toHaveBeenCalled();
  });
  it.each([
    { input: "" }, { input: "x".repeat(10001) }, { input: "Task", graph: { fake: true } },
    { input: "Task", context: { today: "2000-01-01" } }, { input: "Task", context: { timezone: "US/Pacific" } },
  ])("rejects untrusted request context or shape", async body => {
    expect((await POST(request(body))).status).toBe(400); expect(dependencies.parse).not.toHaveBeenCalled();
  });
});
