import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createECDH } from "node:crypto";
import { openDatabase, type LocalDatabase } from "@/lib/server/db";
import { GET, POST } from "@/app/api/push/route";
import { createPushStore } from "@/lib/server/push-store";

let database: LocalDatabase;
vi.mock("@/lib/server/db", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/server/db")>(), getDatabase: () => database }));
const pair = createECDH("prime256v1"); pair.setPrivateKey(Buffer.alloc(32, 1));
const token = "c".repeat(64);
const subscription = { endpoint: "https://web.push.apple.com/route-test", keys: { p256dh: pair.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") } };
beforeEach(() => {
  database = openDatabase(":memory:");
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("APP_ORIGIN", "https://taesks.test");
  vi.stubEnv("VAPID_PUBLIC_KEY", pair.getPublicKey().toString("base64url")); vi.stubEnv("VAPID_PRIVATE_KEY", pair.getPrivateKey().toString("base64url")); vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.test");
});
afterEach(() => { database.sqlite.close(); vi.unstubAllEnvs(); });
const request = (body: object, origin = "https://taesks.test") => new Request("http://internal:3000/api/push", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
it("registers, inspects, replaces and revokes only this installation through the API", async () => {
  const key = await GET().json(); expect(Object.keys(key).sort()).toEqual(["available", "publicKey", "reason"]);
  const register = await POST(request({ action: "register", deviceToken: token, subscription })); expect(register.status).toBe(200); expect(await register.json()).toEqual({ registered: true });
  const status = await POST(request({ action: "status", deviceToken: token, endpoint: subscription.endpoint })); expect(await status.json()).toEqual({ registered: true });
  const different = await POST(request({ action: "status", deviceToken: "d".repeat(64), endpoint: subscription.endpoint })); expect(await different.json()).toEqual({ registered: false });
  expect((await POST(request({ action: "register", deviceToken: "d".repeat(64), subscription }))).status).toBe(409);
  const replacement = { ...subscription, endpoint: "https://web.push.apple.com/replaced" }; expect((await POST(request({ action: "register", deviceToken: token, subscription: replacement }))).status).toBe(200);
  vi.stubEnv("VAPID_PRIVATE_KEY", ""); expect((await POST(request({ action: "revoke", deviceToken: token }))).status).toBe(200); expect(createPushStore(database).subscriptions()).toEqual([]);
});
it("rejects cross-origin, missing origin, malformed and unsafe subscriptions before storing them", async () => {
  expect((await POST(request({ action: "register", deviceToken: token, subscription }, "https://evil.test"))).status).toBe(403);
  const missing = request({ action: "revoke", deviceToken: token }); missing.headers.delete("origin"); expect((await POST(missing)).status).toBe(403);
  expect((await POST(request({ action: "register", deviceToken: token, subscription: { ...subscription, endpoint: "https://127.0.0.1/private" } }))).status).toBe(400);
  const invalid = request({ action: "revoke", deviceToken: token }); invalid.headers.set("content-type", "text/plain"); expect((await POST(invalid)).status).toBe(415);
  expect(createPushStore(database).subscriptions()).toEqual([]);
});
it("keeps keys and endpoints out of validation and conflict responses", async () => {
  await POST(request({ action: "register", deviceToken: token, subscription }));
  const response = await POST(request({ action: "register", deviceToken: "d".repeat(64), subscription })); const text = await response.text();
  for (const secret of [subscription.endpoint, subscription.keys.auth, token, pair.getPrivateKey().toString("base64url")]) expect(text).not.toContain(secret);
});
