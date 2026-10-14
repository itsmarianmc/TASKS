import "server-only";
import { randomUUID } from "node:crypto";
import { Octokit } from "octokit";
import { AppError } from "./http";
import { repositoryNameSchema, type GitHubDashboard, type GitHubItem, type GitHubRepository, type GitHubSection, type GitHubSectionName, type GitHubSectionResponse } from "../github-contracts";
import type { Diagnostic } from "../types";

type RecordValue = Record<string, unknown>;
export interface GitHubTransport { get(route: string, parameters?: RecordValue): Promise<{ data: unknown; headers?: Record<string, string | number | undefined> }> }
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const string = (value: unknown) => typeof value === "string" ? value : "";
const array = (value: unknown) => Array.isArray(value) ? value : [];
function requireArray(value: unknown): unknown[] { if (!Array.isArray(value)) throw new AppError("GITHUB_DATA", "GitHub returned an invalid list response.", 502); return value; }
const timestamp = (value: unknown) => string(value) && Number.isFinite(Date.parse(string(value))) ? string(value) : null;
const empty = <T,>(disabled = false): GitHubSection<T> => ({ items: [], status: disabled ? "disabled" : "ok", message: disabled ? "Set GITHUB_TOKEN on the server and restart TÆSKS." : "", syncedAt: null, hasMore: false, page: 1 });
/** Only GitHub's HTTPS UI URLs can cross the server boundary. */
export function safeGitHubUrl(value: unknown): string | null {
  try { const url = new URL(string(value)); return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password && !url.port ? url.toString() : null; } catch { return null; }
}
function item(value: unknown, kind: GitHubItem["kind"], repo?: string): GitHubItem {
  const row = record(value), commit = record(row.commit), author = record(row.user ?? row.author);
  const url = safeGitHubUrl(row.html_url);
  const fromUrl = url ? new URL(url).pathname.split("/").slice(1, 3).join("/") : "";
  const repository = repo ?? fromUrl;
  const number = typeof row.number === "number" ? row.number : null;
  const identity = kind === "commit" ? string(row.sha) : kind === "action" ? typeof row.id === "number" ? String(row.id) : "" : number && Number.isInteger(number) && number > 0 ? String(number) : "";
  if (!identity || !repositoryNameSchema.safeParse(repository).success) throw new AppError("GITHUB_DATA", "GitHub returned an item without a valid identity.", 502);
  return { id: `${repository.toLowerCase()}:${kind === "review" ? "pull" : kind}:${identity}`, kind, title: string(row.title) || string(row.display_title) || string(row.name) || string(commit.message).split("\n")[0] || "Untitled activity", repository, number, url, body: (kind === "commit" ? string(commit.message) : string(row.body)).slice(0, 100_000), state: kind === "action" ? string(row.conclusion) || string(row.status) : string(row.state) || "committed", author: string(author.login) || string(record(commit.author).name) || null, updatedAt: timestamp(row.updated_at ?? row.created_at ?? record(commit.author).date), labels: array(row.labels).map(label => typeof label === "string" ? label : string(record(label).name)).filter(Boolean), branch: string(row.head_branch ?? record(row.head).ref) || null };
}
export class GitHubAdapter {
  private cache = new Map<string, { expires: number; data: GitHubSection<unknown> }>();
  private inflight = new Map<string, Promise<GitHubSection<unknown>>>();
  private identity: string | null = null;
  private identityPromise?: Promise<string>;
  private transport: GitHubTransport;
  constructor(private config: { token?: string; username?: string }, transport?: GitHubTransport, private now = () => Date.now()) {
    const octokit = transport ? null : new Octokit({ auth: config.token, retry: { enabled: false }, throttle: { enabled: false }, log: { debug() {}, info() {}, warn() {}, error() {} }, request: { timeout: 15_000 } });
    this.transport = transport ?? { get: async (route, parameters) => { if (!route.startsWith("GET ")) throw new AppError("GITHUB_READ_ONLY", "GitHub only supports reading in TÆSKS."); const response = await octokit!.request(route, { ...parameters, headers: { "X-GitHub-Api-Version": "2026-03-10" }, request: { signal: AbortSignal.timeout(15_000) } }); return { data: response.data, headers: response.headers }; } };
  }
  get configured() { return !!this.config.token; }
  private async username(): Promise<string> {
    if (this.identity) return this.identity;
    if (!this.identityPromise) this.identityPromise = (async () => {
      const name = this.config.username?.trim() || string(record((await this.transport.get("GET /user")).data).login);
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(name)) throw new AppError("GITHUB_USERNAME", "Check GITHUB_USERNAME or the token's authenticated user.", 502);
      this.identity = name; return name;
    })().finally(() => { this.identityPromise = undefined; });
    return this.identityPromise;
  }
  private async cached<T>(key: string, force: boolean, load: () => Promise<GitHubSection<T>>): Promise<GitHubSection<T>> {
    if (!this.configured) return empty<T>(true);
    const previous = this.cache.get(key);
    if (!force && previous && previous.expires > this.now()) return previous.data as GitHubSection<T>;
    if (!force && previous) {
      void this.cached(key, true, load).catch(() => undefined);
      return previous.data as GitHubSection<T>;
    }
    if (this.inflight.has(key)) return this.inflight.get(key)! as Promise<GitHubSection<T>>;
    const promise = (async () => {
      let value: GitHubSection<T>;
      try { value = await load(); } catch (error) {
        const correlationId = randomUUID(); const status = typeof record(error).status === "number" ? record(error).status as number : error instanceof AppError ? error.status : 502;
        const headers = record(record(error).response).headers;
        const rateLimited = status === 429 || status === 403 && string(record(headers)["x-ratelimit-remaining"]) === "0";
        const message = rateLimited ? "GitHub rate limit reached. Wait before refreshing." : status === 401 ? "GitHub rejected the token. Check expiry and restart after updating it." : status === 403 || status === 404 ? "GitHub denied access. Check selected repositories, organization approval and the section's read permission." : status === 422 ? "GitHub could not search this account. Check username and repository access." : "GitHub could not be read. Check connectivity and retry.";
        console.error(JSON.stringify({ source: "github", operation: key, status, correlationId }));
        value = { ...(previous?.data as GitHubSection<T> ?? empty<T>()), status: "error", message: `${message}${previous?.data.syncedAt ? " Last synced data retained." : ""}`, correlationId };
      }
      this.cache.set(key, { expires: this.now() + 60_000, data: value });
      if (this.cache.size > 150) this.cache.delete(this.cache.keys().next().value!);
      return value;
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise); return promise;
  }
  private diagnostic(sections: GitHubSection<unknown>[]): Diagnostic {
    const errors = sections.filter(section => section.status === "error");
    return { source: "github", status: !this.configured ? "disabled" : errors.length ? "error" : "ok", message: !this.configured ? empty(true).message : errors.length ? "Some GitHub sections could not be verified." : "GitHub read access verified for the displayed sections.", details: errors.map(section => `${section.message} [${section.correlationId}]`), checkedAt: new Date(this.now()).toISOString() };
  }
  async dashboard(force = false, page = 1): Promise<GitHubDashboard> {
    const repositories = this.cached<GitHubRepository>("repositories", force, async () => {
      const items: GitHubRepository[] = []; let hasMore = true; let current = 1;
      while (hasMore && current <= 100) {
        const response = await this.transport.get("GET /user/repos", { per_page: 100, page: current++, sort: "updated", affiliation: "owner,collaborator,organization_member" });
        for (const value of requireArray(response.data)) { const row = record(value); const name = string(row.full_name); if (!repositoryNameSchema.safeParse(name).success || typeof row.id !== "number") throw new AppError("GITHUB_DATA", "GitHub returned an invalid repository identity.", 502); items.push({ id: String(row.id), name, description: string(row.description), url: safeGitHubUrl(row.html_url), private: row.private === true, archived: row.archived === true, updatedAt: timestamp(row.updated_at) }); }
        hasMore = !!String(response.headers?.link ?? "").includes('rel="next"');
      }
      return { items: items.filter((repo, index) => items.findIndex(value => value.id === repo.id) === index), status: "ok", message: hasMore ? "Repository list limited to 10,000 entries. Narrow token access." : "", hasMore, page: 1, syncedAt: new Date(this.now()).toISOString() };
    });
    const search = (kind: "issue" | "review") => this.cached<GitHubItem>(`${kind}:${page}`, force, async () => {
      const username = await this.username();
      const response = await this.transport.get("GET /search/issues", { q: kind === "review" ? `is:pr is:open review-requested:${username}` : `is:issue is:open assignee:${username}`, sort: "updated", order: "desc", per_page: 50, page });
      const data = record(response.data);
      if (!Array.isArray(data.items) || typeof data.total_count !== "number" || !Number.isInteger(data.total_count) || data.total_count < 0) throw new AppError("GITHUB_DATA", "GitHub returned invalid search results.", 502);
      const total = data.total_count;
      const incomplete = data.incomplete_results === true || total > 1000;
      return { items: array(data.items).map(value => item(value, kind)), status: "ok", message: incomplete ? "GitHub search is incomplete or exceeds its 1,000-result limit. Open GitHub to narrow the search." : "", total, incomplete, hasMore: page < 20 && page * 50 < Math.min(total, 1000), page, syncedAt: new Date(this.now()).toISOString() };
    });
    const [repos, issues, reviews] = await Promise.all([repositories, search("issue"), search("review")]);
    return { configured: this.configured, username: this.identity, repositories: repos, issues, reviews, diagnostics: [this.diagnostic([repos, issues, reviews])] };
  }
  async section(repository: string, section: GitHubSectionName, page = 1, force = false): Promise<GitHubSectionResponse> {
    const name = repositoryNameSchema.parse(repository); const [owner, repo] = name.split("/");
    const data = await this.cached<GitHubItem>(`${name.toLowerCase()}:${section}:${page}`, force, async () => {
      const route = section === "actions" ? "GET /repos/{owner}/{repo}/actions/runs" : `GET /repos/{owner}/{repo}/${section}`;
      const response = await this.transport.get(route, { owner, repo, per_page: 50, page, ...(section === "issues" || section === "pulls" ? { state: "open", sort: "updated", direction: "desc" } : {}) });
      const rows = section === "actions" ? requireArray(record(response.data).workflow_runs) : requireArray(response.data);
      const filtered = section === "issues" ? rows.filter(value => !record(value).pull_request) : rows;
      const kind = section === "pulls" ? "pull" : section === "actions" ? "action" : section === "commits" ? "commit" : "issue";
      return { items: filtered.map(value => item(value, kind, name)), status: "ok", message: "", syncedAt: new Date(this.now()).toISOString(), hasMore: !!String(response.headers?.link ?? "").includes('rel="next"'), page };
    });
    return { repository: name, section, data, diagnostics: [this.diagnostic([data])] };
  }
  async validateRepository(name: string) {
    const repository = repositoryNameSchema.parse(name); if (!this.configured) return repository;
    const [owner, repo] = repository.split("/");
    try { const response = await this.transport.get("GET /repos/{owner}/{repo}", { owner, repo }); const canonical = string(record(response.data).full_name); if (!repositoryNameSchema.safeParse(canonical).success) throw new Error("Invalid repository response"); return canonical; }
    catch { throw new AppError("GITHUB_REPOSITORY_ACCESS", "Repository access could not be verified. Check token selection, spelling and organization approval before saving.", 422); }
  }
}
let singleton: { fingerprint: string; adapter: GitHubAdapter } | undefined;
export function githubAdapter() {
  const token = process.env.GITHUB_TOKEN?.trim(), username = process.env.GITHUB_USERNAME?.trim();
  const fingerprint = `${token ?? ""}:${username ?? ""}`;
  if (!singleton || singleton.fingerprint !== fingerprint) singleton = { fingerprint, adapter: new GitHubAdapter({ token, username }) };
  return singleton.adapter;
}
