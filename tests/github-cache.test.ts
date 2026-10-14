import { expect, it } from "vitest";
import { collectGitHubCache } from "@/lib/github-queries";
import type { GitHubItem } from "@/lib/github-contracts";
const item = (repository: string, number: number, kind: GitHubItem["kind"] = "pull"): GitHubItem => ({ id: "different-database-id", kind, repository, number, title: `Task ${number}`, url: null, body: "context", state: "open", author: null, updatedAt: null, labels: [], branch: null });
const section = (items: GitHubItem[]) => ({ items, status: "ok", hasMore: false });
it("searches all genuinely cached pages and prior repo contexts with canonical PR identities", () => {
  const values = collectGitHubCache([
    { key: ["github", "dashboard", 2], data: { issues: section([item("owner/older", 42, "issue")]), reviews: section([item("Owner/Repo", 7, "review")]), repositories: { items: [{ id: "repository-older", name: "owner/older" }], hasMore: true, status: "ok" } } },
    { key: ["github", "section", "owner/repo", "pulls", 3], data: { data: { ...section([item("owner/repo", 7)]), status: "error" } } },
    { key: ["github", "section", "owner/prior", "issues", 2], data: { data: section([item("owner/prior", 9, "issue")]) } },
  ]);
  expect(values.items.map(value => value.id)).toEqual(["owner/older:issue:42", "owner/repo:pull:7", "owner/prior:issue:9"]);
  expect(values.items[1].kind).toBe("pull"); expect(values.repositories[0].name).toBe("owner/older");
  expect(values.message).toContain("More activity"); expect(values.message).toContain("out of date");
});
it("keeps healthy complete search results free of implementation copy", () => {
  const values = collectGitHubCache([{ key: ["github", "section", "owner/repo", "issues", 1], data: { data: section([item("owner/repo", 1, "issue")]) } }]);
  expect(values.message).toBe("");
  expect(values.items).toHaveLength(1);
});
