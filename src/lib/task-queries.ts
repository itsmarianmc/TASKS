"use client";
import { useRef } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ApiClientError, apiRequest } from "./api-client";
import { queryKeys, type GraphResponse } from "./queries";
import { taskCreateSchema, taskPatchSchema, type TaskCreate, type TaskPatch, type TaskMutationResponse } from "./notion-contracts";
import { optimisticCache, type Intent, type Operation } from "./optimistic";
import { applyLocal, initialMetadata, replaceWhere } from "./local-intents";

import type { LocalSnapshot, Task } from "./types";
import { clientId } from "./client-id";

export type TaskAction = { kind: "create"; body: TaskCreate; tempId?: string } | { kind: "patch"; id: string; body: TaskPatch } | { kind: "delete"; id: string };
export function taskIntent(client: QueryClient, action: TaskAction, request?: () => Promise<TaskMutationResponse | null>): Intent<TaskMutationResponse | null> {
  const cache = optimisticCache(client), now = new Date().toISOString();
  const id = action.kind === "create" ? action.tempId ?? `temp:${clientId()}` : action.id;
  const graph = client.getQueryData<GraphResponse>(queryKeys.graph)?.graph;
  if (action.kind === "create") taskCreateSchema.parse(action.body);
  if (action.kind === "patch") taskPatchSchema.parse(action.body);
  if (action.kind !== "delete") {
    const input = action.kind === "create" ? action.body.task : { ...graph?.tasks.find(task => task.id === cache.resolveId(id) || task.clientKey === id), ...action.body.task };
    if (input.areaId && input.projectId && !graph?.projects.find(project => project.id === input.projectId)?.areaIds.includes(input.areaId)) throw new Error("Choose an area linked to this project.");
    if (action.kind === "create" && (!graph?.areas.some(area => area.id === input.areaId) || !graph.projects.some(project => project.id === input.projectId))) throw new Error("Choose an available area and project.");
  }
  const temporary: Task | null = action.kind === "create" ? { ...action.body.task, id, clientKey: id, syncState: "creating", highlight: action.body.task.highlight ?? false, completed: false, url: "", createdAt: now, updatedAt: now } : null;
  let confirmedId: string | undefined;
  return {
    key: cache.entityKey("task", id), targets: action.kind === "create" || (action.kind === "patch" && action.body.completed !== undefined) ? [queryKeys.graph, queryKeys.local] : [queryKeys.graph],
    apply: (data, key) => {
      if (!data) return data;
      const realId = cache.resolveId(id);
      if (key[0] === "graph") {
        const value = data as GraphResponse;
        const tasks = action.kind === "create" ? replaceWhere(value.graph.tasks, task => task.id === id || task.id === realId, [temporary!]) : action.kind === "delete" ? value.graph.tasks.filter(task => task.id !== realId && task.clientKey !== id) : value.graph.tasks.map(task => task.id === realId || task.clientKey === id ? { ...task, ...action.body.task, ...(action.body.completed === undefined ? {} : { completed: action.body.completed, completedAt: action.body.completed ? now : null }) } : task);
        return { ...value, graph: { ...value.graph, tasks } };
      }
      let local = data as LocalSnapshot;
      if (action.kind === "patch" && action.body.completed !== undefined) {
        const previous = local.metadata.find(item => item.taskId === realId) ?? initialMetadata(realId, now);
        local = { ...local, metadata: replaceWhere(local.metadata, item => item.taskId === realId || item.taskId === id, [{ ...previous, completedAt: action.body.completed ? now : null, updatedAt: now }]) };
      }
      if (action.kind === "create") {
        if (action.body.metadata) local = applyLocal(local, { action: "setTaskMetadata", taskId: id, patch: action.body.metadata }, `${id}:metadata`, now);
        if (action.body.tags) local = applyLocal(local, { action: "setTaskTags", taskId: id, tags: action.body.tags }, `${id}:tags`, now);
        if (action.body.source) local = applyLocal(local, { action: "linkExternal", ...action.body.source, taskId: id }, `${id}:source`, now);
      }
      return local;
    },
    request: request ?? (async () => {
      if (action.kind === "create") return apiRequest<TaskMutationResponse>("/api/tasks", { method: "POST", body: JSON.stringify(action.body) });
      const realId = cache.resolveId(id);
      if (realId.startsWith("temp:")) throw new Error("Task creation was not confirmed.");
      if (action.kind === "delete") { await apiRequest(`/api/tasks/${encodeURIComponent(realId)}`, { method: "DELETE", body: JSON.stringify({ confirmed: true }) }); return null; }
      return apiRequest<TaskMutationResponse>(`/api/tasks/${encodeURIComponent(realId)}`, { method: "PATCH", body: JSON.stringify(action.body) });
    }),
    reconcile: (data, result, key) => {
      if (action.kind === "create" && result && !confirmedId) { confirmedId = result.task.id; cache.assignId(id, result.task.id); }
      if (!data) return data;
      if (key[0] === "graph") {
        const value = data as GraphResponse;
        if (action.kind === "delete") return { ...value, graph: { ...value.graph, tasks: value.graph.tasks.filter(task => task.id !== cache.resolveId(id)) } };
        if (!result) return value;
        const previous = value.graph.tasks.find(task => task.id === cache.resolveId(id));
        const task = { ...result.task, completedAt: result.task.completedAt ?? (result.task.completed ? (action.kind === "patch" && action.body.completed === true ? now : previous?.completedAt) : null), clientKey: action.kind === "create" ? id : previous?.clientKey };
        let tasks = replaceWhere(value.graph.tasks, old => old.id === id || old.id === task.id, [task]);
        if (result.nextTask) tasks = replaceWhere(tasks, old => old.id === result.nextTask!.id, [result.nextTask]);
        return { ...value, graph: { ...value.graph, tasks } };
      }
      let local = data as LocalSnapshot;
      if (result?.snapshot) {
        for (const taskId of [result.task.id, ...(result.nextTask ? [result.nextTask.id] : [])]) {
          local = { ...local,
            metadata: replaceWhere(local.metadata, item => item.taskId === id || item.taskId === taskId, result.snapshot.metadata.filter(item => item.taskId === taskId)),
            taskTags: replaceWhere(local.taskTags, item => item.taskId === id || item.taskId === taskId, result.snapshot.taskTags.filter(item => item.taskId === taskId)),
          };
        }
        const tagIds = new Set(local.taskTags.map(item => item.tagId));
        local = { ...local, tags: [...local.tags, ...result.snapshot.tags.filter(tag => tagIds.has(tag.id) && !local.tags.some(old => old.id === tag.id))] };
        if (action.kind === "create" && action.body.source) {
          const source = action.body.source;
          local = { ...local, externalLinks: replaceWhere(local.externalLinks, item => item.source === source.source && item.externalId === source.externalId, result.snapshot.externalLinks.filter(item => item.source === source.source && item.externalId === source.externalId)) };
        }
      }
      return local;
    },
    errorMessage: action.kind === "create" ? "Couldn't create task." : action.kind === "delete" ? "Couldn't delete task." : action.body.completed === true ? "Couldn't complete task." : action.body.completed === false ? "Couldn't reopen task." : "Couldn't update task.",
    // A POST or recurring completion must never be repeated following an uncertain response.
    canRetry: error => action.kind !== "create" && (!(action.kind === "patch" && action.body.completed === true) || error instanceof ApiClientError && error.code === "OFFLINE"),
  };
}
export function useTaskMutation() {
  const client = useQueryClient(), cache = optimisticCache(client);
  const operations = useRef(new WeakMap<TaskAction, Operation<TaskMutationResponse | null>>()).current;
  return useMutation({
    onMutate: (action: TaskAction) => { const op = cache.begin(taskIntent(client, action)); operations.set(action, op); return op; },
    mutationFn: (action: TaskAction) => cache.request(operations.get(action)!),
    onSuccess: (result, _action, op) => {
      cache.succeed(op, result);
      for (const warning of result?.warnings ?? []) cache.warn(warning);
      // Recurrence side effects are accepted only after the existing server ledger confirms them.
      if (result?.nextTask && result.snapshot) cache.merge<LocalSnapshot>(queryKeys.local, old => old && { ...old, metadata: replaceWhere(old.metadata, item => item.taskId === result.nextTask!.id, result.snapshot!.metadata.filter(item => item.taskId === result.nextTask!.id)), taskTags: replaceWhere(old.taskTags, item => item.taskId === result.nextTask!.id, result.snapshot!.taskTags.filter(item => item.taskId === result.nextTask!.id)), tags: [...old.tags, ...result.snapshot!.tags.filter(tag => !old.tags.some(item => item.id === tag.id))] });
    },
    onError: (error, _action, op) => { if (op) cache.fail(op, error); },
    onSettled: (_result, _error, _action, op) => op?.release(), retry: false,
  });
}

