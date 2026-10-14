import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ list: vi.fn(), mutate: vi.fn() }));
vi.mock("../src/lib/server/contact", () => ({ contactAdapter: () => mock }));
import { GET } from "../src/app/api/contact/route";
import { DELETE, PATCH } from "../src/app/api/contact/[id]/route";
const context = { params: Promise.resolve({ id: "7" }) };
function request(method: string, body: unknown, origin = "http://localhost:3000") { return new Request("http://localhost:3000/api/contact/7", { method, headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) }); }
beforeEach(() => { mock.list.mockReset(); mock.mutate.mockReset(); mock.list.mockResolvedValue({ items: [], status: "ok" }); mock.mutate.mockResolvedValue({ id: 7, is_read: true }); });
describe("Contact route boundary", () => {
  it("strips force-refresh from the stable adapter options", async () => { const response = await GET(new Request("http://localhost/api/contact?refresh=1&filter=unread&page=2")); expect(response.status).toBe(200); expect(mock.list).toHaveBeenCalledWith({ filter: "unread", page: 2, sort: "newest", site: "", search: "" }, true); });
  it.each(["url=http://evil", "filter=eq.false", "page=0"])("rejects unsafe/invalid public query %s", async query => { expect((await GET(new Request(`http://localhost/api/contact?${query}`))).status).toBe(400); expect(mock.list).not.toHaveBeenCalled(); });
  it("requires same-origin for read mutations and deliberate deletion", async () => { expect((await PATCH(request("PATCH", { is_read: true }, "https://evil.test"), context)).status).toBe(403); expect((await DELETE(request("DELETE", { confirmed: false }), context)).status).toBe(400); expect(mock.mutate).not.toHaveBeenCalled(); });
  it("limits writes to the declared read boolean and positive ID", async () => { expect((await PATCH(request("PATCH", { is_read: true, message: "overwrite" }), context)).status).toBe(400); expect((await PATCH(request("PATCH", { is_read: true }), { params: Promise.resolve({ id: "eq.1" }) })).status).toBe(400); expect(mock.mutate).not.toHaveBeenCalled(); });
  it("returns only confirmed mark/deletion results", async () => { expect((await PATCH(request("PATCH", { is_read: true }), context)).status).toBe(200); expect(mock.mutate).toHaveBeenLastCalledWith(7, true); const deleted = await DELETE(request("DELETE", { confirmed: true }), context); expect(await deleted.json()).toEqual({ deleted: true, id: 7 }); expect(mock.mutate).toHaveBeenLastCalledWith(7); });
});
