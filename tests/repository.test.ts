import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase, recoverInterruptedConversions, type LocalDatabase } from "@/lib/server/db";
import { createRepository } from "@/lib/server/repository";
import type { LocalMutation } from "@/lib/schemas";
import { migrations } from "@/lib/server/db/migrations";

const databases: LocalDatabase[] = [];
const directories: string[] = [];
function setup() {
  const db = openDatabase(":memory:"); databases.push(db);
  return { db, repo: createRepository(db) };
}
afterEach(() => { databases.splice(0).forEach(db => db.sqlite.close()); directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });

describe("local persistence", () => {
  it("migrates a real database once and keeps data across reopen", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "taesks-db-")); directories.push(directory);
    const filename = path.join(directory, "taesks.db");
    const first = openDatabase(filename);
    await createRepository(first).mutate({ action: "saveNote", entityType: "project", entityId: "project-1", content: "## Persistent\n`code`" });
    createRepository(first).claimExternalConversion("draft", "draft-persistent");
    createRepository(first).finishExternalConversion("draft", "draft-persistent", "task-confirmed");
    createRepository(first).claimExternalConversion("contact", "interrupted-source");
    first.sqlite.close();
    const second = openDatabase(filename); databases.push(second);
    recoverInterruptedConversions(second);
    expect((await createRepository(second).snapshot()).notes[0].content).toContain("Persistent");
    expect(createRepository(second).getExternalConversion("draft", "draft-persistent")).toMatchObject({ taskId: "task-confirmed", state: "complete" });
    expect(createRepository(second).getExternalConversion("contact", "interrupted-source")).toMatchObject({ taskId: null, state: "uncertain" });
    createRepository(second).reconcileConversion({ inspected: true, source: { source: "contact", externalId: "interrupted-source", url: null }, taskId: "verified-existing" });
    expect((await createRepository(second).snapshot()).externalLinks[0].taskId).toBe("verified-existing");
    expect(second.sqlite.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()?.count).toBe(migrations.length);
  });
  it("starts empty with complete default preferences", async () => {
    const { repo } = setup();
    const data = await repo.snapshot();
    expect(data.notes).toEqual([]); expect(data.drafts).toEqual([]); expect(data.metadata).toEqual([]);
    expect(data.preferences.theme).toBe("system"); expect(data.notionMapping).toEqual({});
  });
  it("keeps independent concurrent preference changes from navigation, theme and sidebar", async () => {
    const { repo } = setup();
    await Promise.all([
      repo.mutate({ action: "setPreferences", patch: { theme: "dark" } }),
      repo.mutate({ action: "setPreferences", patch: { lastView: "project:english" } }),
      repo.mutate({ action: "setPreferences", patch: { sidebarCollapsed: true } }),
      repo.mutate({ action: "setPreferences", patch: { notificationPermissionAsked: true } }),
    ]);
    expect(await repo.getPreferences()).toEqual({ theme: "dark", lastView: "project:english", sidebarCollapsed: true, notificationPermissionAsked: true, literalQuotedText: true, showCompletedTasks: true, hideProjectsWithoutCurrentTasks: false });
  });
  it("upserts one note per entity without affecting a different entity", async () => {
    const { repo } = setup();
    await repo.mutate({ action: "saveNote", entityType: "project", entityId: "x", content: "First" });
    const id = (await repo.snapshot()).notes[0].id;
    await repo.mutate({ action: "saveNote", entityType: "project", entityId: "x", content: "Second" });
    await repo.mutate({ action: "saveNote", entityType: "task", entityId: "x", content: "Task" });
    const notes = (await repo.snapshot()).notes;
    expect(notes).toHaveLength(2); expect(notes.find(note => note.id === id)?.content).toBe("Second");
    await repo.mutate({ action: "deleteNote", entityType: "project", entityId: "x" });
    expect((await repo.snapshot()).notes.map(note => note.content)).toEqual(["Task"]);
  });
  it("merges metadata patches and tags without duplicating names", async () => {
    const { repo } = setup();
    await repo.mutate({ action: "setTaskMetadata", taskId: "t", patch: { priority: "high", someday: true } });
    await repo.mutate({ action: "setTaskMetadata", taskId: "t", patch: { reminderAt: "2026-10-03T19:00:00+02:00" } });
    await repo.mutate({ action: "setTaskTags", taskId: "t", tags: ["School", "school", "waiting"] });
    await repo.mutate({ action: "setTaskTags", taskId: "t2", tags: ["school"] });
    const data = await repo.snapshot();
    expect(data.metadata[0]).toMatchObject({ priority: "high", someday: true, reminderAt: "2026-10-03T19:00:00+02:00" });
    expect(data.tags).toHaveLength(2); expect(data.taskTags).toHaveLength(3);
    await repo.mutate({ action: "setTaskTags", taskId: "t", tags: [] });
    expect((await repo.snapshot()).taskTags).toHaveLength(1);
  });
  it("edits a link without changing its identity or entity and rejects unsafe URLs", async () => {
    const { repo } = setup();
    await repo.mutate({ action: "addLink", entityType: "project", entityId: "p", label: "Before", url: "https://example.com/before" });
    const before = (await repo.snapshot()).links[0];
    await repo.mutate({ action: "updateLink", id: before.id, label: "After", url: "https://example.com/after" });
    expect((await repo.snapshot()).links[0]).toEqual({ ...before, label: "After", url: "https://example.com/after" });
    await expect(repo.mutate({ action: "updateLink", id: before.id, label: "Unsafe", url: "javascript:alert(1)" })).rejects.toThrow();
    await expect(repo.mutate({ action: "updateLink", id: "absent", label: "Missing", url: "https://example.com" })).rejects.toMatchObject({ code: "LINK_NOT_FOUND" });
  });
  it("rolls back tag replacement if insertion fails", async () => {
    const { db, repo } = setup();
    await repo.mutate({ action: "setTaskTags", taskId: "t", tags: ["before"] });
    db.sqlite.exec("CREATE TRIGGER reject_tags BEFORE INSERT ON tags WHEN NEW.name='forbidden' BEGIN SELECT RAISE(ABORT, 'rejected'); END;");
    await expect(repo.mutate({ action: "setTaskTags", taskId: "t", tags: ["new", "forbidden"] })).rejects.toThrow();
    const data = await repo.snapshot();
    expect(data.taskTags).toHaveLength(1); expect(data.tags.map(tag => tag.name)).toEqual(["before"]);
  });
  it("persists aliases, filters, mappings and unresolved drafts", async () => {
    const { repo } = setup();
    await repo.mutate({ action: "saveAlias", entityType: "project", entityId: "english", alias: "English class" });
    await repo.mutate({ action: "saveFilter", name: "Urgent", criteria: { priority: "urgent", completed: false } });
    await repo.mutate({ action: "saveIntegration", projectId: "english", repository: "marian/taesks" });
    await repo.mutate({ action: "setPreferences", patch: { theme: "light" } });
    await repo.mutate({ action: "setNotionMapping", mapping: { completionProperty: "Status", completionValue: "Done" } });
    const action = { action: "saveDraft", draft: { input: "Write essay", title: "Write essay" } } as unknown as LocalMutation;
    await repo.mutate(action);
    const data = await repo.snapshot();
    expect(data.aliases[0].alias).toBe("English class"); expect(data.filters[0].criteria).toEqual({ priority: "urgent", completed: false });
    expect(data.integrations[0].repository).toBe("marian/taesks"); expect(data.preferences.theme).toBe("light");
    expect(data.notionMapping.completionProperty).toBe("Status"); expect(data.drafts[0]).toMatchObject({ projectId: null, areaId: null, priority: "none" });
  });
  it("keeps external conversion links stable and claims each recurrence once", async () => {
    const { repo } = setup();
    await repo.mutate({ action: "linkExternal", source: "contact", externalId: "42", taskId: "first", url: null });
    await expect(repo.mutate({ action: "linkExternal", source: "contact", externalId: "42", taskId: "second", url: null })).rejects.toMatchObject({ code: "CONVERSION_CONFLICT" });
    expect((await repo.snapshot()).externalLinks[0].taskId).toBe("first");
    expect(repo.claimRecurrence("first")).toBe(true); expect(repo.claimRecurrence("first")).toBe(false);
    repo.finishRecurrence("first", "next");
    expect(repo.getRecurrence("first")).toMatchObject({ state: "complete", nextTaskId: "next" });
    expect(repo.claimRecurrence("first")).toBe(false);
  });
  it("never exposes an attachment storage path to clients", async () => {
    const { repo } = setup();
    await repo.addAttachment({ id: "a", entityType: "area", entityId: "x", name: "a.txt", storageName: "private-storage", mimeType: "text/plain", size: 8, createdAt: new Date().toISOString() });
    expect((await repo.snapshot()).attachments[0]).not.toHaveProperty("storageName");
    expect((await repo.getAttachment("a"))?.storageName).toBe("private-storage");
  });
});
