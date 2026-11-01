"use client";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { CompletionController, type CompletionEntry } from "./completion";
import { useTaskMutation } from "./task-queries";
import type { Task } from "./types";

export const completionKey = ["completion-feedback"] as const;
export const emptyCompletions: CompletionEntry[] = [];
const controllers = new WeakMap<QueryClient, CompletionController>();
export function completionController(client: QueryClient) {
  let controller = controllers.get(client);
  if (!controller) { controller = new CompletionController(entries => client.setQueryData(completionKey, entries)); controllers.set(client, controller); }
  return controller;
}
export function useCompletion() {
  const client = useQueryClient(), mutation = useTaskMutation();
  return (task: Task) => completionController(client).change(task, (id, completed) => mutation.mutateAsync({ kind: "patch", id, body: { completed } }));
}
