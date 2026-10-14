import { expect, test } from "@playwright/test";

test("local health works without optional credentials", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: "ok", services: { localDatabase: "ok" } });
});

test("production headers remove eval while keeping the Next bootstrap functional", async ({ request }) => {
  const response = await request.get("/"); expect(response.status()).toBe(200);
  const headers = response.headers(); expect(headers["content-security-policy"]).not.toContain("unsafe-eval");
  expect(headers["content-security-policy"]).toContain("script-src 'self' 'unsafe-inline'");
  expect(headers["x-content-type-options"]).toBe("nosniff"); expect(headers["x-frame-options"]).toBe("DENY");
});
