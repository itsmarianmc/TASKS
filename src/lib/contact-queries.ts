"use client";
import { hashKey, useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback, useRef, useSyncExternalStore } from "react";
import { apiRequest } from "./api-client";
import { defaultContactOptions, type ContactItem, type ContactOptions, type ContactResponse } from "./contact-contracts";
import { optimisticCache, optimisticRead, type Intent, type Operation } from "./optimistic";
export function contactUrl(options: ContactOptions, force = false) { const params = new URLSearchParams({ ...options, page: String(options.page), ...(force ? { refresh: "1" } : {}) }); return `/api/contact?${params}`; }
export function useContact(options: ContactOptions = defaultContactOptions, enabled = true) {
  const client = useQueryClient(); const key = ["contact", options] as const;
  return useQuery({ queryKey: key, queryFn: ({ signal }) => optimisticRead(client, key, () => apiRequest<ContactResponse>(contactUrl(options), { signal })), retry: false, staleTime: 60_000, enabled, refetchInterval: 60_000, refetchIntervalInBackground: false, refetchOnWindowFocus: true });
}
export function useContactCachedItems() {
  const client = useQueryClient(); const revision = useRef(0);
  const subscribe = useCallback((notify: () => void) => client.getQueryCache().subscribe(event => {
    if ((event.query.queryKey[0] === "contact" || event.query.queryKey[0] === "contact-item") && (event.type === "removed" || (event.type === "updated" && event.action.type === "success"))) { revision.current++; notify(); }
  }), [client]);
  useSyncExternalStore(subscribe, () => revision.current, () => 0);
  const items = new Map<number, ContactItem>();
  for (const query of client.getQueryCache().findAll({ queryKey: ["contact"] }).sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt)) for (const item of (query.state.data as ContactResponse | undefined)?.items ?? []) items.set(item.id, item);
  for (const query of client.getQueryCache().findAll({ queryKey: ["contact-item"] })) {
    const item = query.state.data as ContactItem | null | undefined;
    if (item) items.set(item.id, item); else if (item === null) items.delete(Number(query.queryKey[1]));
  }
  return [...items.values()];
}
export function useContactItem(item: ContactItem) {
  return useQuery<ContactItem | null>({ queryKey: ["contact-item", item.id], initialData: item, enabled: false, queryFn: () => item }).data ?? item;
}
export function matchesContact(item: ContactItem, options: ContactOptions) {
  return (options.filter === "all" || (options.filter === "read") === item.is_read) && (!options.site || item.site_origin === options.site) && (!options.search || [item.name, item.email, item.message, item.site_origin].some(value => value.toLocaleLowerCase().includes(options.search.toLocaleLowerCase())));
}
export type ContactAction = { id: number; read?: boolean };
export type ContactResult = { item?: ContactItem; deleted?: boolean };
export function contactIntent(client: QueryClient, action: ContactAction, request?: () => Promise<ContactResult>): Intent<ContactResult> {
  const cache = optimisticCache(client), itemKey = ["contact-item", action.id] as const;
  const original = client.getQueryData<ContactItem>(itemKey) ?? client.getQueriesData<ContactResponse>({ queryKey: ["contact"] }).flatMap(([, data]) => data?.items ?? []).find(item => item.id === action.id);
  if (!original) throw new Error("Refresh this message before changing it.");
  if (!client.getQueryData(itemKey)) client.setQueryData(itemKey, original);
  const next = action.read === undefined ? null : { ...original, is_read: action.read };
  const targets = [itemKey, ...client.getQueryCache().findAll({ queryKey: ["contact"] }).map(query => query.queryKey)];
  const knownKeys = new Set(targets.map(hashKey));
  function patch(data: unknown, key: QueryKey, confirmed = next) {
    if (key[0] === "contact-item") return confirmed;
    if (!data) return data;
    const value = data as ContactResponse, options = key[1] as ContactOptions;
    const countsPending = value.countsPending || !knownKeys.has(hashKey(key)) && !value.items.some(item => item.id === action.id);
    const before = value.items.find(item => item.id === original!.id) ?? original!;
    const wasIncluded = matchesContact(before, options), included = !!confirmed && matchesContact(confirmed, options);
    let items = value.items.flatMap(item => item.id === action.id ? included ? [confirmed!] : [] : [item]);
    // Insert only where the row belongs on the currently cached page. Counts cover off-page changes too.
    if (included && !items.some(item => item.id === action.id)) {
      const ordered = (a: ContactItem, b: ContactItem) => (a.created_at.localeCompare(b.created_at) || a.id - b.id) * (options.sort === "newest" ? -1 : 1);
      if (options.page === 1 && (!value.hasMore || !items.length || ordered(confirmed!, items.at(-1)!) <= 0) || options.page > 1 && items.length && ordered(confirmed!, items[0]) >= 0 && ordered(confirmed!, items.at(-1)!) <= 0) items = [...items, confirmed!].sort(ordered);
    }
    const total = value.total === null ? null : Math.max(0, value.total + Number(included) - Number(wasIncluded));
    const unreadDelta = Number(!!confirmed && !confirmed.is_read) - Number(!before.is_read);
    return { ...value, items, total: countsPending ? null : total, unreadTotal: countsPending || value.unreadTotal === null ? null : Math.max(0, value.unreadTotal + unreadDelta), countsPending, hasMore: total === null ? value.hasMore : value.hasMore && total > (options.page - 1) * 50 + items.length };
  }
  return {
    key: cache.entityKey("contact", String(action.id)), targets,
    matches: key => key[0] === "contact" || key[0] === "contact-item" && key[1] === action.id,
    apply: (data, key) => patch(data, key),
    request: request ?? (() => apiRequest<ContactResult>(`/api/contact/${action.id}`, { method: action.read === undefined ? "DELETE" : "PATCH", body: JSON.stringify(action.read === undefined ? { confirmed: true } : { is_read: action.read }) })),
    reconcile: (data, result, key) => patch(data, key, action.read === undefined ? null : result.item ?? next),
    errorMessage: action.read === undefined ? "Couldn't delete message." : "Couldn't update message.",
  };
}
export function useContactMutation() {
  const client = useQueryClient(), cache = optimisticCache(client);
  const operations = useRef(new WeakMap<ContactAction, Operation<ContactResult>>()).current;
  return useMutation({
    onMutate: (action: ContactAction) => { const op = cache.begin(contactIntent(client, action)); operations.set(action, op); return op; },
    mutationFn: (action: ContactAction) => cache.request(operations.get(action)!),
    onSuccess: (result, _action, op) => {
      cache.succeed(op, result);
      // A page opened during the write may already include its server count delta. Verify just those unknown counts silently.
      for (const query of client.getQueryCache().findAll({ queryKey: ["contact"], type: "active" })) if ((query.state.data as ContactResponse | undefined)?.countsPending) void client.cancelQueries({ queryKey: query.queryKey, exact: true }).then(() => client.fetchQuery({ queryKey: query.queryKey, queryFn: ({ signal }) => optimisticRead(client, query.queryKey, () => apiRequest<ContactResponse>(contactUrl(query.queryKey[1] as ContactOptions, true), { signal })), staleTime: 0 })).catch(() => {});
    },
    onError: (error, _action, op) => { if (op) cache.fail(op, error); },
    onSettled: (_result, _error, _action, op) => op?.release(), retry: false,
  });
}
