import { QueryClient, hashKey, type QueryKey } from "@tanstack/react-query";
import { ApiClientError, isCachedResponse } from "./api-client";
import type { Task } from "./types";
import type { GraphResponse } from "./queries";
import type { ContactResponse } from "./contact-contracts";
import { clientId } from "./client-id";

export type SyncState = "pending" | "offline" | "unsaved";
export interface MutationStatus {
  operations: { id: string; key: string; state: SyncState; message: string; retryable: boolean }[];
  errors: { id: string; message: string; retryable: boolean }[];
}
export const mutationStatusKey = ["mutation-status"] as const;
export const emptyMutationStatus: MutationStatus = { operations: [], errors: [] };
export interface Intent<T = unknown> {
  key: string;
  targets: QueryKey[];
  matches?: (key: QueryKey) => boolean;
  apply: (data: unknown, key: QueryKey, state: SyncState) => unknown;
  reconcile: (data: unknown, result: T, key: QueryKey) => unknown;
  request: () => Promise<T>;
  errorMessage: string;
  keepOnError?: boolean;
  retainKey?: string;
  discardRetained?: string;
  canRetry?: (error: unknown) => boolean;
}
export interface Operation<T = unknown> {
  id: string; spec: Intent<T>; state: SyncState; previous: Promise<void>;
  release: () => void; result?: T; error?: unknown;
}
interface Entry { key: QueryKey; data: unknown; revision: number }
const hash = hashKey;
const runtimes = new WeakMap<QueryClient, OptimisticCache>();
export function optimisticCache(client: QueryClient) {
  let runtime = runtimes.get(client);
  if (!runtime) { runtime = new OptimisticCache(client); runtimes.set(client, runtime); }
  return runtime;
}

/** Confirmed query entries plus ordered, entity-scoped intent patches. No UI data lives outside QueryClient. */
export class OptimisticCache {
  private entries = new Map<string, Entry>();
  private operations: Operation[] = [];
  private failed = new Map<string, Operation>();
  private tails = new Map<string, Promise<void>>();
  private aliases = new Map<string, string>();
  private lanes = new Map<string, string>();
  private latest = new Map<string, string>();
  private taskFences = new Map<string, { task: Task | null; updatedAt: string }>();
  private revision = 0;
  constructor(readonly client: QueryClient) {}
  resolveId(id: string) { return this.aliases.get(id) ?? id; }
  entityKey(kind: string, id: string) { return `${kind}:${this.lanes.get(id) ?? id}`; }
  assignId(temporary: string, real: string) {
    this.aliases.set(temporary, real); this.lanes.set(real, temporary);
    if (temporary.startsWith("temp:") && typeof window !== "undefined") {
      try {
        const content = localStorage.getItem(`taesks.note:task:${temporary}`);
        if (content !== null && localStorage.getItem(`taesks.note:task:${real}`) === null) localStorage.setItem(`taesks.note:task:${real}`, content);
        const taskEdit = localStorage.getItem(`taesks.task-edit:${temporary}`);
        if (taskEdit !== null && localStorage.getItem(`taesks.task-edit:${real}`) === null) localStorage.setItem(`taesks.task-edit:${real}`, taskEdit);
      } catch { /* The existing device copy and in-memory intent are retained. */ }
    }
  }
  async confirmedEntityId(id: string) {
    if (id.startsWith("temp:") && !this.aliases.has(id)) await this.tails.get(this.entityKey("task", id));
    const result = this.resolveId(id);
    if (result.startsWith("temp:")) throw new Error("Creation was not confirmed.");
    return result;
  }
  private affects(op: Operation, key: QueryKey) { return op.spec.matches?.(key) ?? op.spec.targets.some(target => hash(target) === hash(key)); }
  private entry(key: QueryKey): Entry {
    let entry = this.entries.get(hash(key));
    if (!entry) { entry = { key, data: this.client.getQueryData(key), revision: this.revision }; this.entries.set(hash(key), entry); }
    return entry;
  }
  private project(entry: Entry) {
    return this.operations.reduce((data, op) => this.affects(op, entry.key) ? op.spec.apply(data, entry.key, op.state) : data, entry.data);
  }
  private publish(op: Operation) {
    this.revision++;
    for (const key of op.spec.targets) this.entry(key);
    for (const query of this.client.getQueryCache().getAll()) if (this.affects(op, query.queryKey)) this.entry(query.queryKey);
    for (const entry of this.entries.values()) if (this.affects(op, entry.key)) {
      entry.revision = this.revision;
      this.client.setQueryData(entry.key, this.project(entry));
    }
    this.status();
  }
  private status() {
    const old = this.client.getQueryData<MutationStatus>(mutationStatusKey) ?? emptyMutationStatus;
    this.client.setQueryData<MutationStatus>(mutationStatusKey, { ...old, errors: old.errors.map(error => ({ ...error, retryable: this.failed.has(error.id) && this.retryable(this.failed.get(error.id)!) })), operations: this.operations.map(op => ({ id: op.id, key: op.spec.key, state: op.state, message: op.spec.errorMessage, retryable: op.state !== "pending" && this.retryable(op) })) });
  }
  private retryable(op: Operation) { return (this.operations.includes(op) || this.latest.get(op.spec.key) === op.id) && (op.spec.canRetry?.(op.error) ?? true); }
  private enqueue(op: Operation) {
    op.previous = this.tails.get(op.spec.key) ?? Promise.resolve();
    const tail = new Promise<void>(resolve => { op.release = resolve; });
    this.tails.set(op.spec.key, tail);
    void tail.then(() => { if (this.tails.get(op.spec.key) === tail) this.tails.delete(op.spec.key); });
  }
  begin<T>(spec: Intent<T>): Operation<T> {
    // Cancellation synchronously reverts in-flight reads before capturing the confirmed cache entry.
    for (const key of spec.targets) void this.client.cancelQueries({ queryKey: key, exact: true });
    if (spec.matches) void this.client.cancelQueries({ predicate: query => spec.matches!(query.queryKey) });
    for (const key of spec.targets) this.entry(key);
    // A newer text/preference save supersedes retained failed text, but never another active request.
    for (const previous of [...this.operations]) if (spec.retainKey && previous.spec.retainKey === spec.retainKey && previous.state !== "pending") {
      this.operations = this.operations.filter(value => value !== previous);
      this.failed.delete(previous.id);
      this.dismiss(previous.id);
    }
    const op: Operation<T> = { id: clientId(), spec, state: "pending", previous: Promise.resolve(), release: () => {} };
    this.enqueue(op as Operation);
    this.latest.set(spec.key, op.id);
    this.operations.push(op as Operation);
    this.publish(op as Operation);
    return op;
  }
  async request<T>(op: Operation<T>) {
    await op.previous;
    const index = this.operations.indexOf(op as Operation);
    if (this.operations.slice(0, index).some(previous => previous.spec.key === op.spec.key && previous.state === "offline")) throw new ApiClientError("Earlier changes are waiting to sync.", 0, "OFFLINE");
    return op.spec.request();
  }
  succeed<T>(op: Operation<T>, result: T) {
    op.result = result;
    if (op.spec.discardRetained) for (const previous of [...this.operations]) if (previous !== op && previous.state !== "pending" && previous.spec.retainKey === op.spec.discardRetained) { this.operations = this.operations.filter(value => value !== previous); this.failed.delete(previous.id); this.dismiss(previous.id); }
    for (const entry of this.entries.values()) if (this.affects(op as Operation, entry.key)) {
      const previous = entry.data;
      entry.data = op.spec.reconcile(entry.data, result, entry.key);
      if (entry.key[0] === "graph" && previous && entry.data) {
        const before = (previous as GraphResponse).graph.tasks, after = (entry.data as GraphResponse).graph.tasks;
        for (const task of before) if (!after.some(next => next.id === task.id)) this.taskFences.set(task.id, { task: null, updatedAt: task.updatedAt });
        for (const task of after) if (task !== before.find(old => old.id === task.id)) this.taskFences.set(task.id, { task, updatedAt: task.updatedAt });
      }
    }
    this.operations = this.operations.filter(value => value !== op);
    this.failed.delete(op.id); this.dismiss(op.id); this.publish(op as Operation);
  }
  fail<T>(typed: Operation<T>, error: unknown) {
    const op = typed as Operation;
    op.error = error;
    const offline = error instanceof ApiClientError && error.code === "OFFLINE";
    if (offline || op.spec.keepOnError) op.state = offline ? "offline" : "unsaved";
    else this.operations = this.operations.filter(value => value !== op);
    this.failed.set(op.id, op);
    const old = this.client.getQueryData<MutationStatus>(mutationStatusKey) ?? emptyMutationStatus;
    this.client.setQueryData(mutationStatusKey, { ...old, errors: [...old.errors.filter(value => value.id !== op.id), { id: op.id, message: offline ? "Offline · changes waiting to sync." : op.spec.errorMessage, retryable: this.retryable(op) }].slice(-5) });
    this.publish(op);
  }
  async retry(id: string) {
    const old = this.failed.get(id); if (!old || !this.retryable(old)) return;
    const index = this.operations.indexOf(old);
    for (const earlier of this.operations.slice(0, index)) if (earlier.spec.key === old.spec.key && earlier.state === "offline") await this.retry(earlier.id);
    this.failed.delete(id); this.dismiss(id);
    const op = index < 0 ? this.begin(old.spec) : old;
    if (index >= 0) { op.state = "pending"; this.enqueue(op); this.publish(op); }
    try { this.succeed(op, await this.request(op)); } catch (error) { this.fail(op, error); } finally { op.release(); }
  }
  dismiss(id: string) {
    const old = this.client.getQueryData<MutationStatus>(mutationStatusKey);
    if (old) this.client.setQueryData(mutationStatusKey, { ...old, errors: old.errors.filter(value => value.id !== id) });
  }
  warn(message: string) {
    const old = this.client.getQueryData<MutationStatus>(mutationStatusKey) ?? emptyMutationStatus;
    this.client.setQueryData(mutationStatusKey, { ...old, errors: [...old.errors, { id: clientId(), message, retryable: false }].slice(-5) });
  }
  discard(id: string) {
    const op = this.failed.get(id); if (!op) return;
    this.operations = this.operations.filter(value => value !== op); this.failed.delete(id); this.dismiss(id); this.publish(op);
  }
  readRevision(key: QueryKey) { return this.entry(key).revision; }
  acceptRead<T>(key: QueryKey, data: T, startedAt: number, retained = false): T {
    const entry = this.entry(key);
    if (entry.revision === startedAt && !(retained && entry.data)) {
      if (key[0] === "graph" && data && entry.data) {
        const incoming = data as unknown as GraphResponse, previous = entry.data as GraphResponse;
        if (incoming.diagnostics.some(item => item.source === "notion" && item.status !== "ok")) data = { ...incoming, graph: previous.graph } as T;
        else {
          let tasks: Task[] = incoming.graph.tasks.map(task => ({ ...task, clientKey: previous.graph.tasks.find(old => old.id === task.id)?.clientKey }));
          for (const [id, fence] of this.taskFences) {
            const task = tasks.find(task => task.id === id);
            const fieldsMatch = task && fence.task && ["title", "areaId", "projectId", "dates", "highlight", "completed"].every(field => JSON.stringify(task[field as keyof Task]) === JSON.stringify(fence.task![field as keyof Task]));
            if (fieldsMatch) this.taskFences.delete(id);
            else if (task && task.updatedAt <= fence.updatedAt) tasks = tasks.flatMap(task => task.id === id ? fence.task ? [fence.task] : [] : [task]);
            else if (!task && fence.task && (!incoming.graph.syncedAt || incoming.graph.syncedAt <= fence.updatedAt)) tasks.push(fence.task);
            else this.taskFences.delete(id);
          }
          data = { ...incoming, graph: { ...incoming.graph, tasks } } as T;
        }
      }
      if (key[0] === "contact" && data && entry.data) {
        const incoming = data as unknown as ContactResponse, previous = entry.data as ContactResponse;
        if (incoming.status === "error") data = { ...incoming, items: previous.items, total: previous.total, unreadTotal: previous.unreadTotal, hasMore: previous.hasMore } as T;
      }
      entry.data = data;
      if (key[0] === "contact" && data) for (const item of (data as unknown as { items: { id: number }[] }).items) {
        const itemKey = ["contact-item", item.id];
        if (!this.operations.some(op => this.affects(op, itemKey))) this.merge(itemKey, () => item);
      }
    }
    return this.project(entry) as T;
  }
  /** Accept a confirmed, scoped side effect (e.g. device-draft sync), never replace unrelated tables. */
  merge<T>(key: QueryKey, update: (old: T | undefined) => T | undefined) {
    const entry = this.entry(key); entry.data = update(entry.data as T | undefined); entry.revision = ++this.revision;
    this.client.setQueryData(key, this.project(entry));
  }
}

export async function optimisticRead<T>(client: QueryClient, key: QueryKey, read: () => Promise<T>) {
  const cache = optimisticCache(client), revision = cache.readRevision(key);
  const data = await read();
  return cache.acceptRead(key, data, revision, isCachedResponse(data));
}
