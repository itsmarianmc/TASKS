import { expect, type Page } from "@playwright/test";
import type { Graph, InboxDraft, LocalSnapshot, Task, TaskMetadata } from "../../src/lib/types";
import type { TaskCreate, TaskPatch } from "../../src/lib/notion-contracts";
import type { ContactItem } from "../../src/lib/contact-contracts";

export const instant = "2026-10-03T12:00:00Z";
export const today = "2026-10-03";
export const makeTask = (id: string, title: string, start: string | null = today, end: string | null = "2026-10-09", patch: Partial<Task> = {}): Task => ({ id, title, projectId: "english", areaId: "homework", dates: { start, end }, completed: false, highlight: false, url: `https://notion.so/${id}`, createdAt: instant, updatedAt: instant, ...patch });
const metadata = (taskId: string, patch: Partial<TaskMetadata> = {}): TaskMetadata => ({ taskId, priority: "none", recurrenceRule: null, reminderAt: null, reminderDismissedAt: null, someday: false, createdAt: instant, updatedAt: instant, ...patch });

/** Synthetic upstream data is scoped to Playwright routes, never application runtime. */
export async function workspace(page: Page, githubEnabled = false, contactEnabled = false, open = true, clock = true) {
  if (clock) await page.clock.install({ time: new Date(instant) });
  const state = {
    graph: { syncedAt: instant, areas: [{ id: "homework", name: "Homework", type: "School", url: "https://notion.so/homework", projectIds: ["english", "shared"] }, { id: "work", name: "Work", type: "Professional", url: "https://notion.so/work", projectIds: ["shared"] }], projects: [{ id: "english", name: "English", areaIds: ["homework"], status: "Active", priority: "Medium", dates: { start: today, end: "2026-12-01" }, url: "https://notion.so/english" }, { id: "shared", name: "Shared", areaIds: ["homework", "work"], status: null, priority: null, dates: { start: null, end: null }, url: "https://notion.so/shared" }], tasks: [makeTask("overdue", "Overdue essay", "2026-10-01", "2026-10-02"), makeTask("now", "Review presentation", today, "2026-10-09", { highlight: true }), makeTask("future", "Future highlight", "2026-10-18", "2026-10-20", { highlight: true }), makeTask("done", "Completed reading", today, "2026-10-03", { completed: true, completedAt: instant }), makeTask("someday", "Someday idea", today, null)] } as Graph,
    local: { metadata: [metadata("someday", { someday: true })], notes: [{ id: "note-1", entityType: "task", entityId: "now", content: "## Review notes\nunique search phrase", createdAt: instant, updatedAt: instant }, { id: "orphan-note", entityType: "task", entityId: "absent-task", content: "## Offline research\nStored independently of Notion", createdAt: instant, updatedAt: instant }], attachments: [{ id: "file-1", entityType: "task", entityId: "now", name: "presentation-outline.pdf", mimeType: "application/pdf", size: 420, createdAt: instant }], links: [], tags: [{ id: "school", name: "school", color: null }], taskTags: [{ taskId: "now", tagId: "school" }], aliases: [], filters: [], integrations: [], externalLinks: [], drafts: [], preferences: { theme: "dark", sidebarCollapsed: false, lastView: "today", notificationPermissionAsked: false }, notionMapping: {} } as LocalSnapshot,
    githubReads: [] as string[], creates: [] as TaskCreate[], patches: [] as { id: string; body: TaskPatch }[], deletes: [] as string[], warnings: [] as string[], failCleanup: false, failGraph: false,
    createError: null as null | { status: number; code: string; message: string; details?: unknown },
    contactItems: [{ id: 7, name: "Contact Visitor", email: "visitor+qa@example.com", site_origin: "https://example.com", message: "Tomorrow #7 Contact request\n<script>alert('unsafe')</script>\nunique contact phrase", created_at: instant, is_read: false }, { id: 8, name: "Read Visitor", email: "invalid email", site_origin: "javascript:alert(1)", message: "Already handled message", created_at: instant, is_read: true }] as ContactItem[],
    contactReads: [] as string[], contactWrites: [] as { id: number; method: string; body: unknown }[], failContactRead: false, failContactWrite: false,
  };
  await page.route("**/api/**", async route => {
    const request = route.request(); const pathname = new URL(request.url()).pathname; const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/contact" && contactEnabled) {
      state.contactReads.push(request.url()); const params = new URL(request.url()).searchParams; const filter = params.get("filter"); const search = params.get("search"); const currentPage = Number(params.get("page") || 1);
      const older: ContactItem = { ...state.contactItems[0], id: 70, name: "Older Contact", message: "older searchable source", is_read: true };
      let items = currentPage === 2 || search?.includes("older searchable") ? [older] : state.contactItems;
      if (filter === "unread") items = items.filter(item => !item.is_read); if (filter === "read") items = items.filter(item => item.is_read);
      if (search) items = items.filter(item => `${item.name} ${item.email} ${item.message} ${item.site_origin}`.toLowerCase().includes(search.toLowerCase()));
      return json({ items, total: currentPage === 1 && !search && filter === "all" && items.length ? 51 : items.length, unreadTotal: state.failContactRead ? null : state.contactItems.filter(item => !item.is_read).length, page: currentPage, hasMore: currentPage === 1 && !search && filter === "all", status: state.failContactRead ? "error" : "ok", message: state.failContactRead ? "Contact reread denied; confirmed messages retained." : "", syncedAt: instant, diagnostics: [{ source: "contact", status: state.failContactRead ? "error" : "ok", message: "Fixture Contact read" }] });
    }
    if (pathname.startsWith("/api/contact/") && contactEnabled) {
      const id = Number(pathname.split("/").at(-1)); const body = request.postDataJSON(); state.contactWrites.push({ id, method, body });
      if (state.failContactWrite) return json({ error: { code: "CONTACT_UNCONFIRMED", message: "No affected message confirmed", correlationId: "fixture" } }, 502);
      if (method === "PATCH") { const item = state.contactItems.find(item => item.id === id)!; item.is_read = body.is_read; return json({ item }); }
      expect(body).toEqual({ confirmed: true }); state.contactItems = state.contactItems.filter(item => item.id !== id); return json({ deleted: true, id });
    }
    if (pathname === "/api/contact") return json({ items: [], total: 0, unreadTotal: 0, page: 1, hasMore: false, status: "ok", message: "", syncedAt: instant, diagnostics: [{ source: "contact", status: "ok", message: "Fixture empty Contact read verified" }] });
    if (pathname === "/api/github" && githubEnabled) {
      state.githubReads.push(request.url());
      const params = new URL(request.url()).searchParams;
      const section = params.get("section");
      const data = (items: unknown[]) => ({ items, status: "ok", message: "", syncedAt: instant, hasMore: false, page: 1 });
      const githubItem = { id: "owner/repo:pull:7", kind: "review", title: "Tomorrow #7 parser review", repository: "owner/repo", number: 7, url: "https://github.com/owner/repo/pull/7", body: "## Verify parser\nReview requirement unique external phrase", state: "open", author: "owner", updatedAt: instant, labels: ["parser"], branch: null };
      const diagnostic = [{ source: "github", status: "ok", message: "Fixture GitHub read verified" }];
      if (section) return json({ repository: "owner/repo", section, data: data(section === "pulls" ? [{ ...githubItem, kind: "pull" }] : section === "issues" ? [{ ...githubItem, id: "owner/repo:issue:8", kind: "issue", number: 8, title: "Mobile repository issue" }] : section === "actions" ? [{ ...githubItem, id: "owner/repo:action:900", kind: "action", number: null, title: "CI workflow success", state: "success" }] : [{ ...githubItem, id: "owner/repo:commit:abc", kind: "commit", number: null, title: "Fix repository parser" }]), diagnostics: diagnostic });
      return json({ configured: true, username: "owner", repositories: data([{ id: "repo-1", name: "owner/repo", description: "Mapped project repository", url: "https://github.com/owner/repo", private: true, archived: false, updatedAt: instant }]), issues: data([]), reviews: data([githubItem]), diagnostics: diagnostic });
    }
    if (pathname === "/api/github") return json({ configured: false, username: null, repositories: { items: [], status: "disabled", message: "", syncedAt: null, hasMore: false, page: 1 }, issues: { items: [], status: "disabled", message: "", syncedAt: null, hasMore: false, page: 1 }, reviews: { items: [], status: "disabled", message: "", syncedAt: null, hasMore: false, page: 1 }, diagnostics: [{ source: "github", status: "disabled", message: "Fixture integration disabled" }] });
    if (pathname === "/api/config") return json({ timezone: "Europe/Berlin", maxUploadBytes: 20971520, appName: "TÆSKS" });
    if (pathname === "/api/ai/status") return json({ provider: "Gemini", model: "gemini-3.5-flash-lite", enabled: false, status: "not configured", confidenceThreshold: 0.75 });
    if (pathname === "/api/graph") return state.failGraph ? json({ error: { code: "NOTION_UNAVAILABLE", message: "Refresh failed", correlationId: "fixture" } }, 502) : json({ graph: state.graph, diagnostics: [{ source: "notion", status: "ok", message: "Fixture scope only" }], completionEnabled: true });
    if (pathname === "/api/local" && method === "GET") return json(state.local);
    if (pathname === "/api/local" && method === "POST") {
      const body = request.postDataJSON();
      if (body.action === "setPreferences") state.local.preferences = { ...state.local.preferences, ...body.patch };
      if (body.action === "saveDraft") { const draft: InboxDraft = { ...body.draft, id: body.draft.id ?? `draft-${state.local.drafts.length + 1}`, createdAt: instant, updatedAt: instant }; state.local.drafts = [...state.local.drafts.filter(item => item.id !== draft.id), draft]; }
      if (body.action === "deleteDraft") { if (state.failCleanup) return json({ error: { code: "LOCAL_ERROR", message: "Draft cleanup failed", correlationId: "fixture" } }, 500); state.local.drafts = state.local.drafts.filter(item => item.id !== body.id); }
      if (body.action === "setTaskMetadata") { const current = state.local.metadata.find(item => item.taskId === body.taskId) ?? metadata(body.taskId); state.local.metadata = [...state.local.metadata.filter(item => item.taskId !== body.taskId), { ...current, ...body.patch }]; }
      if (body.action === "setTaskTags") setTags(body.taskId, body.tags);
      if (body.action === "saveFilter") { const filter = { ...body, id: body.id ?? "filter-1", createdAt: instant, updatedAt: instant }; state.local.filters = [...state.local.filters.filter(item => item.id !== filter.id), filter]; }
      return json({ result: null, snapshot: state.local });
    }
    if (pathname === "/api/tasks" && method === "POST") {
      const body = request.postDataJSON() as TaskCreate; state.creates.push(body);
      if (state.createError) return json({ error: { code: state.createError.code, message: state.createError.message, details: state.createError.details, correlationId: "fixture" } }, state.createError.status);
      // A modest asynchronous response makes double-submit guards observable.
      await new Promise(resolve => setTimeout(resolve, 120));
      const created = makeTask(`created-${state.creates.length}`, body.task.title, body.task.dates.start, body.task.dates.end, { ...body.task, highlight: body.task.highlight ?? false });
      state.graph.tasks.push(created);
      if (body.metadata) state.local.metadata.push(metadata(created.id, body.metadata));
      if (body.tags) setTags(created.id, body.tags);
      if (body.source) state.local.externalLinks.push({ id: "fixture-link", ...body.source, taskId: created.id, createdAt: instant });
      return json({ task: created, warnings: state.warnings, snapshot: state.local }, 201);
    }
    if (pathname.startsWith("/api/tasks/") && method === "PATCH") {
      const id = pathname.split("/").at(-1)!; const body = request.postDataJSON() as TaskPatch; state.patches.push({ id, body });
      const task = state.graph.tasks.find(task => task.id === id)!; Object.assign(task, body.task, body.completed === undefined ? {} : { completed: body.completed, completedAt: body.completed ? instant : null });
      return json({ task, warnings: state.warnings, snapshot: state.local });
    }
    if (pathname.startsWith("/api/tasks/") && method === "DELETE") { expect(request.postDataJSON()).toEqual({ confirmed: true }); const id = pathname.split("/").at(-1)!; state.deletes.push(id); state.graph.tasks = state.graph.tasks.filter(task => task.id !== id); return json({ deleted: true }); }
    if (pathname === "/api/notion/schema") return json({ configured: false, apiVersion: "2026-03-11", diagnostics: [], properties: { tasks: [], projects: [], areas: [] }, completionCandidates: [], completion: null });
    return route.continue();
  });
  function setTags(taskId: string, tags: string[]) { state.local.taskTags = state.local.taskTags.filter(item => item.taskId !== taskId); for (const name of tags) { let tag = state.local.tags.find(item => item.name === name); if (!tag) { tag = { id: `tag-${state.local.tags.length}`, name, color: null }; state.local.tags.push(tag); } state.local.taskTags.push({ taskId, tagId: tag.id }); } }
  if (githubEnabled) state.local.integrations.push({ id: "repo-map", projectId: "english", source: "github", repository: "owner/repo", createdAt: instant });
  if (open) { await page.goto("/"); await expect(page.locator("h1")).toHaveText(/Today/); }
  return state;
}
export async function navigate(page: Page, command: string) { await page.keyboard.press("Control+k"); await page.getByRole("textbox", { name: "Search", exact: true }).fill(command); await page.locator(".palette-result").first().click(); }
export async function capture(page: Page, input: string) { await page.keyboard.press("n"); await page.getByRole("textbox", { name: "Task input" }).fill(input); }

