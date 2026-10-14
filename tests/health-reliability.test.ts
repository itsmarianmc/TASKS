import { afterEach, expect, it, vi } from "vitest";
const database = vi.hoisted(() => ({ healthy: true }));
vi.mock("@/lib/server/db", () => ({ databaseHealth: () => database.healthy }));
import { GET } from "@/app/api/health/route";
afterEach(() => { vi.unstubAllEnvs(); database.healthy = true; });
it("reports the enabled default Contact endpoint without claiming live connectivity", async () => {
  vi.stubEnv("CONTACT_API_BASE_URL", ""); vi.stubEnv("NOTION_TOKEN", ""); vi.stubEnv("GITHUB_TOKEN", "");
  const response = GET(); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "ok", services: { localDatabase: "ok", contact: "default", notion: "disabled", github: "disabled" } });
});
it("uses database health independently from configured optional integrations", async () => {
  vi.stubEnv("CONTACT_API_BASE_URL", "http://127.0.0.1:9"); expect((await GET().json()).services.contact).toBe("configured");
  database.healthy = false; expect(GET().status).toBe(503);
});
it("keeps container health independent of optional Gemini configuration", async () => {
  vi.stubEnv("GEMINI_API_KEY", "");
  expect(GET().status).toBe(200);
  expect((await GET().json()).services.gemini).toBe("not configured");
  vi.stubEnv("GEMINI_API_KEY", "test-secret"); vi.stubEnv("GEMINI_FALLBACK_ENABLED", "true");
  const response = GET(); expect(response.status).toBe(200);
  const body = await response.json(); expect(body.services.gemini).toBe("configured");
  expect(JSON.stringify(body)).not.toContain("test-secret");
  vi.stubEnv("GEMINI_FALLBACK_ENABLED", "false"); expect((await GET().json()).services.gemini).toBe("disabled");
});
