"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useSyncExternalStore } from "react";
import { apiRequest } from "./api-client";
import type { GitHubDashboard, GitHubItem, GitHubRepository, GitHubSectionName, GitHubSectionResponse } from "./github-contracts";
export function githubUrl(repository?: string, section?: GitHubSectionName, page = 1, force = false) {
  const search = new URLSearchParams({ page: String(page) });
  if (repository && section) { search.set("repository", repository); search.set("section", section); }
  if (force) search.set("refresh", "1"); return `/api/github?${search}`;
}
export function useGitHub(page = 1) { return useQuery({ queryKey: ["github", "dashboard", page], queryFn: () => apiRequest<GitHubDashboard>(githubUrl(undefined, undefined, page)), retry: false, staleTime: 60_000, refetchInterval: 60_000, refetchIntervalInBackground: false, refetchOnWindowFocus: true }); }
export function useGitHubSection(repository: string, section: GitHubSectionName, page = 1) { return useQuery({ queryKey: ["github", "section", repository, section, page], queryFn: () => apiRequest<GitHubSectionResponse>(githubUrl(repository, section, page)), enabled: !!repository, retry: false, staleTime: 60_000 }); }
export function collectGitHubCache(records: { key: readonly unknown[]; data: unknown }[]) {
  const items = new Map<string, GitHubItem>(); const repositories = new Map<string, GitHubRepository>();
  let limited = false; let failed = false;
  for (const record of records) {
    const sections = record.key[1] === "dashboard" ? (() => { const dashboard = record.data as GitHubDashboard | undefined; for (const repo of dashboard?.repositories.items ?? []) repositories.set(repo.name.toLowerCase(), repo); return dashboard ? [dashboard.issues, dashboard.reviews, dashboard.repositories] : []; })() : record.key[1] === "section" ? [(record.data as GitHubSectionResponse | undefined)?.data].filter(value => !!value) : [];
    for (const section of sections) {
      limited ||= section.hasMore || !!section.incomplete; failed ||= section.status === "error";
      for (const value of section.items) if ("kind" in value) {
        const item = value as GitHubItem;
        const id = item.number !== null && ["pull", "review", "issue"].includes(item.kind) ? `${item.repository.toLowerCase()}:${item.kind === "issue" ? "issue" : "pull"}:${item.number}` : item.id;
        items.set(id, { ...item, id });
      }
    }
  }
  return { items: [...items.values()], repositories: [...repositories.values()], message: [limited ? "More activity on GitHub." : "", failed ? "GitHub refresh failed. Results may be out of date." : ""].filter(Boolean).join(" ") };
}
export function useGitHubCachedItems() {
  const client = useQueryClient(); const revision = useRef(0);
  const subscribe = useCallback((notify: () => void) => client.getQueryCache().subscribe(event => {
    if (event.query.queryKey[0] === "github" && (event.type === "removed" || (event.type === "updated" && event.action.type === "success"))) { revision.current++; notify(); }
  }), [client]);
  useSyncExternalStore(subscribe, () => revision.current, () => 0);
  return collectGitHubCache(client.getQueryCache().findAll({ queryKey: ["github"] }).sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt).map(query => ({ key: query.queryKey, data: query.state.data })));
}
