"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, isCachedResponse, localMutation } from "./api-client";
import type { LocalMutation } from "./schemas";
import type { Diagnostic, Graph, LocalSnapshot } from "./types";
import type { NotionGraphSyncResponse } from "./notion-contracts";
import type { PublicConfig } from "./public-config";
import { githubUrl } from "./github-queries";
import { contactUrl } from "./contact-queries";
import type { ContactOptions } from "./contact-contracts";
import { cachedReadRevision, reportCachedRead } from "./connectivity";
import { optimisticCache, optimisticRead, type Operation } from "./optimistic";
import { applyLocal, localErrorMessage, localLane, prepareLocal, reconcileLocal, resolveLocal } from "./local-intents";
import { localMutationSchema } from "./schemas";
import { clientId } from "./client-id";
import { useRef, useState } from "react";

export interface GraphResponse {
  graph: Graph;
  diagnostics: Diagnostic[];
  completionEnabled?: boolean;
}
export const queryKeys = {
  local: ["local"] as const,
  graph: ["graph"] as const,
  config: ["config"] as const,
};
function mergeGraphSync(current: GraphResponse, update: GraphResponse | NotionGraphSyncResponse): GraphResponse {
  if (!("mode" in update)) return update;
  if (update.mode === "snapshot") return update.response;
  const merge = <T extends { id: string }>(previous: T[], changed: T[], deleted: string[]) => {
    const values = new Map(previous.map(item => [item.id, item]));
    for (const id of deleted) values.delete(id);
    for (const item of changed) values.set(item.id, item);
    return [...values.values()];
  };
  return {
    graph: {
      ...current.graph,
      areas: merge(current.graph.areas, update.areas, update.deletedAreaIds),
      projects: merge(current.graph.projects, update.projects, update.deletedProjectIds),
      tasks: merge(current.graph.tasks, update.tasks, update.deletedTaskIds),
      syncedAt: update.revision,
    },
    diagnostics: update.diagnostics,
    completionEnabled: update.completionEnabled,
  };
}
export function useLocal(initialData?: LocalSnapshot) {
  const client = useQueryClient();
  return useQuery({
    queryKey: queryKeys.local,
    queryFn: ({ signal }) => optimisticRead(client, queryKeys.local, () => apiRequest<LocalSnapshot>("/api/local", { signal })),
    initialData,
    initialDataUpdatedAt: initialData ? 0 : undefined,
    refetchOnMount: true,
  });
}
export function useConfig(initialData?: PublicConfig) {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: () => apiRequest<PublicConfig>("/api/config"),
    initialData,
    initialDataUpdatedAt: initialData ? 0 : undefined,
    staleTime: 300_000,
  });
}
export function useGraph(initialData?: GraphResponse) {
  const client = useQueryClient();
  const queryKey = queryKeys.graph;
  const initialCheck = useRef(true);
  // The merged graph alone cannot tell whether the service worker served saved data.
  const [savedData, setSavedData] = useState(false);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => optimisticRead(client, queryKey, async () => {
      const current = client.getQueryData<GraphResponse>(queryKey);
      const params = new URLSearchParams();
      if (current?.graph.syncedAt) params.set("since", current.graph.syncedAt);
      if (initialCheck.current) params.set("startup", "1");
      let update: GraphResponse | NotionGraphSyncResponse;
      try {
        update = await apiRequest<GraphResponse | NotionGraphSyncResponse>(`/api/graph?${params}`, { signal });
        setSavedData(isCachedResponse(update));
      } finally {
        // A cancelled mount must still verify tasks when the query resumes.
        if (!signal.aborted) initialCheck.current = false;
      }
      if (current) return mergeGraphSync(current, update);
      if (!("mode" in update)) return update;
      if (update.mode === "snapshot") return update.response;
      return { graph: { areas: update.areas, projects: update.projects, tasks: update.tasks, syncedAt: update.revision }, diagnostics: update.diagnostics, completionEnabled: update.completionEnabled };
    }),
    retry: false,
    staleTime: 60_000,
    initialData,
    initialDataUpdatedAt: initialData ? 0 : undefined,
    refetchOnMount: "always",
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  // Retained data does not settle the first task check. AppShell waits for it once;
  // polls and later refreshes never block the opened workspace again.
  return { ...query, savedData, initialTaskCheck: !query.isFetchedAfterMount ? "pending" as const : query.isError ? "error" as const : "ready" as const };
}
export function useLocalMutation() {
  const client = useQueryClient();
  const cache = optimisticCache(client);
  const operations = useRef(new WeakMap<LocalMutation, Operation<{ result: unknown; snapshot: LocalSnapshot }>>()).current;
  return useMutation({
    onMutate: (input: LocalMutation) => {
      const action = prepareLocal(localMutationSchema.parse(input));
      const id = `temp:${clientId()}`, now = new Date().toISOString();
      const op = cache.begin({
        key: localLane(action, client.getQueryData(queryKeys.local), cache), targets: [queryKeys.local],
        apply: data => data ? applyLocal(data as LocalSnapshot, resolveLocal(action, cache), id, now) : data,
        request: async () => {
          const resolved = resolveLocal(action, cache);
          if (("taskId" in resolved && resolved.taskId.startsWith("temp:")) || ("entityId" in resolved && resolved.entityType === "task" && resolved.entityId.startsWith("temp:"))) throw new Error("Task creation was not confirmed.");
          const result = await localMutation(resolved);
          if (action.action === "saveNote" && typeof window !== "undefined") {
            try { for (const entityId of new Set([action.entityId, cache.resolveId(action.entityId)])) { const key = `taesks.note:${action.entityType}:${entityId}`; if (localStorage.getItem(key) === action.content) localStorage.removeItem(key); } } catch { /* Keep the device copy if storage is unavailable. */ }
          }
          return result;
        },
        reconcile: (data, value) => data ? reconcileLocal(data as LocalSnapshot, value.snapshot, resolveLocal(action, cache), id, cache) : data,
        errorMessage: localErrorMessage(action), keepOnError: action.action === "saveNote" || action.action === "setPreferences",
        retainKey: action.action === "saveNote" ? `note:${action.entityType}:${action.entityId}` : action.action === "setPreferences" ? `preferences:${Object.keys(action.patch).sort().join(",")}` : undefined,
        discardRetained: action.action === "deleteNote" ? `note:${action.entityType}:${action.entityId}` : undefined,
      });
      operations.set(input, op); return op;
    },
    mutationFn: (action: LocalMutation) => cache.request(operations.get(action)!),
    onSuccess: (value, _action, op) => cache.succeed(op, value),
    onError: (error, _action, op) => { if (op) cache.fail(op, error); },
    onSettled: (_value, _error, _action, op) => op?.release(),
    retry: false,
  });
}
/** A source may return retained data plus a diagnostic failure in an HTTP 200 response. */
function verifiedRefresh<T extends { diagnostics?: Diagnostic[] }>(promise: Promise<T>) {
  return promise.then(value => {
    if (value.diagnostics?.some(diagnostic => diagnostic.status === "error" || diagnostic.status === "unavailable")) throw new Error("A source could not be refreshed. Its diagnostic and retained data remain available.");
    return value;
  });
}
export function useRefresh() {
  const client = useQueryClient();
  return async (onGraph?: (response: GraphResponse) => void) => {
    await client.cancelQueries({ queryKey: queryKeys.graph });
    const before = cachedReadRevision();
    const localRefresh = client.invalidateQueries({ queryKey: queryKeys.local });
    return Promise.allSettled([
      localRefresh,
      verifiedRefresh(client.fetchQuery({
        queryKey: queryKeys.graph,
        queryFn: ({ signal }) => optimisticRead(client, queryKeys.graph, () => apiRequest<GraphResponse>("/api/graph?refresh=1", { signal })),
        staleTime: 0,
      })).then(async response => { await localRefresh; onGraph?.(response); return response; }),
      client.invalidateQueries({ queryKey: ["diagnostics"] }),
      ...client.getQueryCache().findAll({ queryKey: ["github"], type: "active" }).map(query => {
        const [, kind, repositoryOrPage, section, page] = query.queryKey;
        return verifiedRefresh(client.fetchQuery({ queryKey: query.queryKey, queryFn: () => apiRequest<{ diagnostics: Diagnostic[] }>(githubUrl(kind === "section" ? String(repositoryOrPage) : undefined, kind === "section" ? section as import("./github-contracts").GitHubSectionName : undefined, kind === "section" ? Number(page) : Number(repositoryOrPage) || 1, true)), staleTime: 0 }));
      }),
      ...client.getQueryCache().findAll({ queryKey: ["contact"], type: "active" }).map(query => verifiedRefresh(client.fetchQuery({ queryKey: query.queryKey, queryFn: ({ signal }) => optimisticRead(client, query.queryKey, () => apiRequest<{ diagnostics: Diagnostic[] }>(contactUrl(query.queryKey[1] as ContactOptions, true), { signal })), staleTime: 0 }))),
    ]).then(results => { if (navigator.onLine && before === cachedReadRevision() && results.every(result => result.status === "fulfilled")) reportCachedRead(null); return results; });
  };
}
