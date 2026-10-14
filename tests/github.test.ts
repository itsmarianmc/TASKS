import { describe, expect, it, vi } from "vitest";
import { GitHubAdapter, safeGitHubUrl, type GitHubTransport } from "../src/lib/server/github";
import { githubActionable, mappedGitHubProject, repositoryNameSchema } from "../src/lib/github-contracts";

const repo = { id: 1, full_name: "owner/repo", html_url: "https://github.com/owner/repo", private: true, description: "Actual description", updated_at: "2026-10-03T12:00:00Z" };
const issue = { id: 20, number: 7, title: "Repair parser", body: "### details", state: "open", html_url: "https://github.com/owner/repo/issues/7", updated_at: "2026-10-03T12:00:00Z", user: { login: "owner" }, labels: [{ name: "bug" }] };
function setup(override?: GitHubTransport["get"]) {
  const calls: { route: string; parameters: Record<string, unknown> }[] = [];
  const get = vi.fn<GitHubTransport["get"]>(async (route, parameters = {}) => {
    calls.push({ route, parameters }); if (override) return override(route, parameters);
    if (route === "GET /user") return { data: { login: "owner" } };
    if (route === "GET /user/repos") return { data: [repo] };
    if (route === "GET /search/issues") return { data: { total_count: 1, incomplete_results: false, items: [{ ...issue, html_url: String(parameters.q).includes("is:pr") ? "https://github.com/owner/repo/pull/7" : issue.html_url }] } };
    if (route.endsWith("/actions/runs")) return { data: { workflow_runs: [{ id: 900, display_title: "CI parser", status: "completed", conclusion: "success", html_url: "https://github.com/owner/repo/actions/runs/900", head_branch: "main" }] } };
    if (route.endsWith("/commits")) return { data: [{ sha: "abcdef0123456789", html_url: "https://github.com/owner/repo/commit/abcdef0123456789", commit: { message: "Fix parser\n\nDetailed explanation", author: { name: "Owner", date: "2026-10-03T12:00:00Z" } } }] };
    if (route === "GET /repos/{owner}/{repo}") return { data: repo };
    return { data: [issue] };
  });
  let clock = Date.parse("2026-10-03T12:00:00Z");
  const adapter = new GitHubAdapter({ token: "secret-token" }, { get }, () => clock);
  return { adapter, get, calls, advance: () => { clock += 61_000; } };
}
describe("GitHub read-only adapter", () => {
  it("is genuinely disabled without a token and never contacts the upstream", async () => {
    const get = vi.fn(); const adapter = new GitHubAdapter({}, { get });
    const dashboard = await adapter.dashboard(); expect(dashboard.configured).toBe(false); expect(dashboard.diagnostics[0].status).toBe("disabled"); expect(get).not.toHaveBeenCalled();
    expect((await adapter.section("owner/repo", "actions")).data.status).toBe("disabled"); expect(get).not.toHaveBeenCalled();
  });
  it("paginates every repository page and deduplicates IDs", async () => {
    const { adapter, calls } = setup(async (route, params) => route === "GET /user/repos" ? { data: params?.page === 1 ? [repo] : [repo, { ...repo, id: 2, full_name: "owner/other" }], headers: params?.page === 1 ? { link: '<https://api.github.com/user/repos?page=2>; rel="next"' } : {} } : route === "GET /user" ? { data: { login: "owner" } } : { data: { items: [], total_count: 0, incomplete_results: false } });
    const data = await adapter.dashboard(); expect(data.repositories.items.map(value => value.name)).toEqual(["owner/repo", "owner/other"]); expect(calls.filter(value => value.route === "GET /user/repos").map(value => value.parameters.page)).toEqual([1, 2]);
  });
  it("normalizes issues, PRs, workflows and commit details and performs GET only", async () => {
    const { adapter, calls } = setup();
    const dashboard = await adapter.dashboard();
    expect(dashboard.issues.items[0]).toMatchObject({ id: "owner/repo:issue:7", labels: ["bug"], author: "owner" });
    expect(dashboard.reviews.items[0]).toMatchObject({ kind: "review", id: "owner/repo:pull:7" });
    const [actions, commits, pulls] = await Promise.all([adapter.section("owner/repo", "actions"), adapter.section("owner/repo", "commits"), adapter.section("owner/repo", "pulls")]);
    expect(actions.data.items[0]).toMatchObject({ title: "CI parser", state: "success", branch: "main" }); expect(commits.data.items[0]).toMatchObject({ title: "Fix parser", body: "Fix parser\n\nDetailed explanation" }); expect(pulls.data.items[0].kind).toBe("pull"); expect(calls.every(call => call.route.startsWith("GET "))).toBe(true);
    expect(calls.filter(call => call.route.startsWith("GET /repos")).every(call => call.parameters.owner === "owner" && call.parameters.repo === "repo")).toBe(true);
  });
  it("uses the canonical PR number when search issue-ID and pull database-ID differ", async () => {
    const { adapter } = setup(async route => route === "GET /user" ? { data: { login: "owner" } } : route === "GET /user/repos" ? { data: [repo] } : route === "GET /search/issues" ? { data: { items: [{ ...issue, id: 1234, html_url: "https://github.com/owner/repo/pull/7" }], total_count: 1 } } : { data: [{ ...issue, id: 9876, html_url: "https://github.com/owner/repo/pull/7" }] });
    const dashboard = await adapter.dashboard(); const pulls = await adapter.section("owner/repo", "pulls"); expect(dashboard.reviews.items[0].id).toBe(pulls.data.items[0].id); expect(pulls.data.items[0].id).toBe("owner/repo:pull:7");
  });
  it("filters pull requests from repository issues without hiding pagination", async () => {
    const { adapter } = setup(async () => ({ data: [{ ...issue, pull_request: {} }, { ...issue, number: 8 }], headers: { link: '<next>; rel="next"' } }));
    const data = await adapter.section("owner/repo", "issues", 2); expect(data.data.items).toHaveLength(1); expect(data.data.items[0].number).toBe(8); expect(data.data.hasMore).toBe(true); expect(data.data.page).toBe(2);
  });
  it("keeps permitted sections usable when Actions access fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { adapter } = setup(async route => { if (route.includes("actions")) throw { status: 403, message: "secret-token raw body", response: { headers: { authorization: "Bearer secret-token" } } }; return { data: [issue] }; });
    const [issues, actions] = await Promise.all([adapter.section("owner/repo", "issues"), adapter.section("owner/repo", "actions")]); expect(issues.data.status).toBe("ok"); expect(actions.data.status).toBe("error"); expect(actions.data.message).toContain("read permission"); expect(JSON.stringify(actions)).not.toContain("secret-token"); expect(JSON.stringify(log.mock.calls)).not.toContain("secret-token"); log.mockRestore();
  });
  it("retains stale data with its original timestamp and forces actual upstream reads", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {}); let fail = false;
    const { adapter, get, advance } = setup(async () => { if (fail) throw { status: 502 }; return { data: [issue] }; });
    const first = await adapter.section("owner/repo", "issues"); await adapter.section("owner/repo", "issues"); expect(get).toHaveBeenCalledTimes(1);
    await adapter.section("owner/repo", "issues", 1, true); expect(get).toHaveBeenCalledTimes(2);
    fail = true; advance(); const stale = await adapter.section("owner/repo", "issues"); expect(stale.data.items).toEqual(first.data.items); expect(stale.data.syncedAt).toBe(first.data.syncedAt); expect(stale.data.status).toBe("error"); expect(stale.data.message).toContain("Last synced"); log.mockRestore();
  });
  it("deduplicates simultaneous reads including requested identity discovery", async () => {
    const { adapter, get } = setup(); await Promise.all([adapter.dashboard(), adapter.dashboard()]); expect(get.mock.calls.filter(call => call[0] === "GET /user")).toHaveLength(1); expect(get.mock.calls.filter(call => call[0] === "GET /user/repos")).toHaveLength(1); expect(get.mock.calls.filter(call => call[0] === "GET /search/issues")).toHaveLength(2);
  });
  it("reports incomplete searches and GitHub's 1,000-result boundary", async () => {
    const { adapter } = setup(async route => route === "GET /user" ? { data: { login: "owner" } } : route === "GET /user/repos" ? { data: [] } : { data: { total_count: 1400, incomplete_results: true, items: [issue] } });
    const data = await adapter.dashboard(false, 20); expect(data.issues.incomplete).toBe(true); expect(data.issues.hasMore).toBe(false); expect(data.issues.message).toContain("1,000");
  });
  it("reports primary rate limits safely", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {}); const { adapter } = setup(async () => { throw { status: 403, response: { headers: { "x-ratelimit-remaining": "0" } } }; }); expect((await adapter.section("owner/repo", "issues")).data.message).toContain("rate limit"); log.mockRestore();
  });
  it.each(["issues", "pulls", "commits", "actions"] as const)("rejects malformed successful %s bodies", async section => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {}); const { adapter } = setup(async () => ({ data: { unexpected: "corrupt" } })); expect((await adapter.section("owner/repo", section)).data.status).toBe("error"); log.mockRestore();
  });
  it("rejects malformed repository and search bodies", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {}); const { adapter } = setup(async route => route === "GET /user" ? { data: { login: "owner" } } : route === "GET /user/repos" ? { data: [{ ...repo, full_name: "../escape" }] } : { data: { total_count: 0 } }); const data = await adapter.dashboard(); expect(data.repositories.status).toBe("error"); expect(data.reviews.status).toBe("error"); expect(data.issues.status).toBe("error"); log.mockRestore();
  });
  it("validates mappings against the repository endpoint and canonicalizes its name", async () => {
    const { adapter } = setup(); expect(await adapter.validateRepository("Owner/Repo")).toBe("owner/repo"); const denied = setup(async () => { throw { status: 404, message: "secret-token" }; }); await expect(denied.adapter.validateRepository("owner/repo")).rejects.toMatchObject({ code: "GITHUB_REPOSITORY_ACCESS" });
  });
  it.each(["../repo", "owner/..", "owner/repo/extra", "https://github.com/owner/repo", "owner/repo?secret=x", "-owner/repo"])("rejects unsafe repository input %s", value => { expect(repositoryNameSchema.safeParse(value).success).toBe(false); });
  it.each(["javascript:alert(1)", "http://github.com/owner/repo", "https://user:pass@github.com/owner/repo", "https://github.com.evil/owner/repo", "https://github.com:444/owner/repo"])("does not expose unsafe GitHub URLs %s", value => { expect(safeGitHubUrl(value)).toBeNull(); });
  it("resolves only unique mapped projects and deduplicates actionable identities", async () => {
    expect(mappedGitHubProject("OWNER/repo", [{ projectId: "one", repository: "owner/repo" }])).toBe("one"); expect(mappedGitHubProject("owner/repo", [{ projectId: "one", repository: "owner/repo" }, { projectId: "two", repository: "owner/repo" }])).toBeUndefined(); const { adapter } = setup(); const data = await adapter.dashboard(); data.issues.items = data.reviews.items; expect(githubActionable(data)).toHaveLength(1);
  });
});
