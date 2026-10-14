import { z } from "zod";
import type { Diagnostic } from "./types";

export const repositoryNameSchema = z.string().trim().max(256).regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]+$/).refine(value => ![".", ".."].includes(value.split("/")[1]), "Use owner/repository.");
export const githubSections = ["issues", "pulls", "actions", "commits"] as const;
export type GitHubSectionName = typeof githubSections[number];
export interface GitHubItem {
  id: string; kind: "issue" | "pull" | "review" | "action" | "commit";
  title: string; repository: string; number: number | null; url: string | null;
  body: string; state: string; author: string | null; updatedAt: string | null;
  labels: string[]; branch: string | null;
}
export interface GitHubRepository { id: string; name: string; description: string; url: string | null; private: boolean; archived: boolean; updatedAt: string | null }
export interface GitHubSection<T = GitHubItem> { items: T[]; status: "ok" | "error" | "disabled"; message: string; syncedAt: string | null; hasMore: boolean; page: number; total?: number; incomplete?: boolean; correlationId?: string }
export interface GitHubDashboard { configured: boolean; username: string | null; repositories: GitHubSection<GitHubRepository>; issues: GitHubSection; reviews: GitHubSection; diagnostics: Diagnostic[] }
export interface GitHubSectionResponse { repository: string; section: GitHubSectionName; data: GitHubSection; diagnostics: Diagnostic[] }
export function githubActionable(data?: GitHubDashboard): GitHubItem[] { return [...(data?.reviews.items ?? []), ...(data?.issues.items ?? [])].filter((item, index, all) => all.findIndex(value => value.id === item.id) === index); }
export function mappedGitHubProject(repository: string, integrations: { repository: string; projectId: string }[]) {
  const matches = integrations.filter(value => value.repository.toLowerCase() === repository.toLowerCase());
  return matches.length === 1 ? matches[0].projectId : undefined;
}
