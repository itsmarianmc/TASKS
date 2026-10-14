import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

async function worker() {
  const origin = "https://taesks.test";
  const listeners = new Map<string, (event: { request: Request; respondWith: (value: Promise<Response>) => void; waitUntil: (value: Promise<unknown>) => void }) => void>();
  const values = new Map<string, Response>();
  const key = (input: Request | string) => typeof input === "string" ? new URL(input, origin).href : input.url;
  const cache = { put: async (input: Request | string, value: Response) => { values.set(key(input), value); }, match: async (input: Request | string) => values.get(key(input))?.clone(), keys: async () => [...values.keys()].map(url => new Request(url)), delete: async (input: Request | string) => values.delete(key(input)) };
  let offline = false;
  const pending: Promise<unknown>[] = [];
  vm.runInNewContext(await readFile("public/service-worker.js", "utf8"), { self: { location: { origin }, addEventListener: (name: string, listener: typeof listeners extends Map<string, infer T> ? T : never) => listeners.set(name, listener) }, URL, Response, Headers, caches: { open: async () => cache }, fetch: async () => { if (offline) throw new Error("Disconnected"); return Response.json({ items: [] }); } });
  return { values, offline: () => { offline = true; }, dispatch: async (url: string, method = "GET") => {
    let response: Promise<Response> | undefined;
    listeners.get("fetch")!({ request: new Request(new URL(url, origin), { method }), respondWith: value => { response = value; }, waitUntil: value => { pending.push(value); } });
    const result = response ? await response : undefined; await Promise.all(pending.splice(0)); return result;
  } };
}
describe("the actual service worker policy", () => {
  it("never intercepts mutations, health, downloads, arbitrary routes or external origins", async () => {
    const sw = await worker();
    for (const [url, method] of [["/api/local", "POST"], ["/api/tasks/one", "PATCH"], ["/api/contact/7", "DELETE"], ["/api/health", "GET"], ["/api/attachments/file", "GET"], ["/api/not-supported", "GET"], ["https://external.test/api/graph", "GET"]]) expect(await sw.dispatch(url, method)).toBeUndefined();
    expect(sw.values.size).toBe(0);
  });
  it("parallel reads keep the 150-entry bound and force refresh shares an honest offline read key", async () => {
    const sw = await worker();
    for (let i = 0; i < 150; i++) sw.values.set(`https://taesks.test/api/contact?page=old${i}`, Response.json({}));
    await Promise.all(Array.from({ length: 20 }, (_, i) => sw.dispatch(`/api/contact?page=${i}&refresh=1`)));
    expect(sw.values.size).toBe(150); expect(sw.values.has("https://taesks.test/api/contact?page=19")).toBe(true);
    sw.offline(); const result = await sw.dispatch("/api/contact?page=19");
    expect(result?.headers.get("X-Taesks-Offline")).toBe("1"); expect(result?.headers.get("X-Taesks-Cached-At")).toBeTruthy();
    expect((await sw.dispatch("/api/graph"))?.type).toBe("error");
  });
});
