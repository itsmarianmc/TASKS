import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { openDatabase, type LocalDatabase } from "@/lib/server/db";
import { createRepository } from "@/lib/server/repository";

const state = vi.hoisted(() => ({ directory: "", repo: null as unknown, failWrite: false }));
vi.mock("node:fs/promises", async original => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args);
    if (!state.failWrite) return handle;
    return new Proxy(handle, { get(target, key) {
      if (key === "writeFile") return async () => { await target.writeFile("partial bytes"); throw new Error("Injected disk write failure"); };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
  } };
});
vi.mock("@/lib/server/config", () => ({ dataDirectory: () => state.directory }));
vi.mock("@/lib/server/repository", async original => ({ ...await original<typeof import("@/lib/server/repository")>(), repository: () => state.repo }));
vi.mock("@/lib/server/github", () => ({ githubAdapter: () => ({ validateRepository: async (value: string) => value }) }));
import { POST as upload } from "@/app/api/attachments/route";
import { GET as download, DELETE as remove } from "@/app/api/attachments/[id]/route";
import { GET as localRead, POST as localWrite } from "@/app/api/local/route";

let database: LocalDatabase;
let repo: ReturnType<typeof createRepository>;
const origin = "http://localhost:3018";
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonRequest = (body: unknown, method = "POST") => new Request(`${origin}/api/local`, { method, headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
const bytes = Buffer.from("Local persistence ✓\n## Context\n<escaped>\n", "utf8");
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
function uploadRequest(file = new File([bytes], "../../résumé.txt", { type: "text/plain" })) {
  const form = new FormData(); form.set("file", file); form.set("entityType", "project"); form.set("entityId", "orphan-project");
  return new Request(`${origin}/api/attachments`, { method: "POST", headers: { origin }, body: form });
}
beforeEach(async () => {
  state.failWrite = false;
  state.directory = await mkdtemp(path.join(tmpdir(), "taesks-local-files-"));
  database = openDatabase(path.join(state.directory, "taesks.db")); repo = createRepository(database); state.repo = repo;
});
afterEach(async () => { database.sqlite.close(); await rm(state.directory, { recursive: true, force: true }); });

describe("real local HTTP, SQLite and upload storage", () => {
  it("preserves independent entity content and binary checksums across database reopen", async () => {
    const note = "# Architecture\n```ts\nconst n = 1;\n```\n- List\n[Docs](https://example.com)\n<script>unsafe</script>";
    expect((await localWrite(jsonRequest({ action: "saveNote", entityType: "project", entityId: "orphan-project", content: note }))).status).toBe(200);
    const uploaded = await upload(uploadRequest()); expect(uploaded.status).toBe(201);
    const attachment = await uploaded.json(); expect(attachment.name).toBe("résumé.txt"); expect(attachment).not.toHaveProperty("storageName");
    database.sqlite.close(); database = openDatabase(path.join(state.directory, "taesks.db")); repo = createRepository(database); state.repo = repo;
    const snapshot = await (await localRead()).json(); expect(snapshot.notes[0].content).toBe(note); expect(snapshot.attachments[0].id).toBe(attachment.id);
    const result = await download(new Request(`${origin}/api/attachments/${attachment.id}`), context(attachment.id));
    expect(hash(new Uint8Array(await result.arrayBuffer()))).toBe(hash(bytes));
    expect(result.headers.get("content-disposition")).toContain("attachment;"); expect(result.headers.get("x-content-type-options")).toBe("nosniff"); expect(result.headers.get("content-security-policy")).toContain("sandbox");
    expect((await remove(jsonRequest({ confirmed: false }, "DELETE"), context(attachment.id))).status).toBe(400);
    expect((await repo.snapshot()).attachments).toHaveLength(1);
    expect((await remove(jsonRequest({ confirmed: true }, "DELETE"), context(attachment.id))).status).toBe(200);
    expect((await repo.snapshot()).attachments).toHaveLength(0); expect(await readdir(path.join(state.directory, "uploads"))).toEqual([]);
    expect((await download(new Request(origin), context(attachment.id))).status).toBe(404);
  });
  it("cleans a written file when metadata insertion fails", async () => {
    database.sqlite.exec("CREATE TRIGGER reject_upload BEFORE INSERT ON attachments BEGIN SELECT RAISE(ABORT,'test failure'); END;");
    expect((await upload(uploadRequest())).status).toBe(500);
    expect((await repo.snapshot()).attachments).toEqual([]); expect(await readdir(path.join(state.directory, "uploads"))).toEqual([]);
  });
  it("cleans partial bytes when writing fails before metadata insertion", async () => {
    state.failWrite = true;
    expect((await upload(uploadRequest())).status).toBe(500);
    expect((await repo.snapshot()).attachments).toEqual([]); expect(await readdir(path.join(state.directory, "uploads"))).toEqual([]);
  });
  it("restores the downloadable file when metadata deletion fails", async () => {
    const attachment = await (await upload(uploadRequest())).json();
    database.sqlite.exec("CREATE TRIGGER reject_delete BEFORE DELETE ON attachments BEGIN SELECT RAISE(ABORT,'test failure'); END;");
    expect((await remove(jsonRequest({ confirmed: true }, "DELETE"), context(attachment.id))).status).toBe(500);
    expect((await repo.snapshot()).attachments).toHaveLength(1);
    const result = await download(new Request(origin), context(attachment.id)); expect(hash(new Uint8Array(await result.arrayBuffer()))).toBe(hash(bytes));
    expect((await readdir(path.join(state.directory, "uploads"))).length).toBe(1);
  });
  it("reports missing physical files honestly and permits removing their stale metadata", async () => {
    const attachment = await (await upload(uploadRequest())).json();
    const [filename] = await readdir(path.join(state.directory, "uploads")); await unlink(path.join(state.directory, "uploads", filename));
    expect((await download(new Request(origin), context(attachment.id))).status).toBe(404);
    expect((await remove(jsonRequest({ confirmed: true }, "DELETE"), context(attachment.id))).status).toBe(200);
    expect((await repo.snapshot()).attachments).toEqual([]);
  });
  it("rejects active types, empty files, large files, bad entity fields and unsafe links before persistence", async () => {
    for (const file of [new File(["<script>x</script>"], "x.html", { type: "text/html" }), new File([], "empty.txt", { type: "text/plain" }), new File([new Uint8Array(20 * 1024 * 1024 + 1)], "big.bin", { type: "application/octet-stream" })]) expect((await upload(uploadRequest(file))).status).toBeGreaterThanOrEqual(400);
    const form = new FormData(); form.set("file", new File([bytes], "good.txt", { type: "text/plain" })); form.set("entityType", "invalid"); form.set("entityId", "orphan-project");
    expect((await upload(new Request(`${origin}/api/attachments`, { method: "POST", headers: { origin }, body: form }))).status).toBe(400);
    expect((await localWrite(jsonRequest({ action: "addLink", entityType: "project", entityId: "orphan-project", label: "unsafe", url: "https://secret:password@example.com" }))).status).toBe(400);
    expect((await repo.snapshot()).attachments).toEqual([]); expect((await repo.snapshot()).links).toEqual([]);
    expect(await readFile(path.join(state.directory, "taesks.db"))).toBeTruthy();
  });
});
