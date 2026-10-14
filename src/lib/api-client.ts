import type { ApiErrorBody, LocalSnapshot } from "./types";
import type { LocalMutation } from "./schemas";
import { reportCachedRead } from "./connectivity";
const cachedResponses = new WeakSet<object>();
export const isCachedResponse = (value: unknown) => !!value && typeof value === "object" && cachedResponses.has(value);

export class ApiClientError extends Error {
  constructor(message: string, public status: number, public code: string, public correlationId?: string, public details?: unknown) { super(message); this.name = "ApiClientError"; }
}
export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  if (init?.method && init.method !== "GET" && typeof navigator !== "undefined" && !navigator.onLine) throw new ApiClientError("Offline. Reconnect to save; your edits stay here.", 0, "OFFLINE");
  const response = await fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000), headers: { ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...init?.headers } });
  if (typeof window !== "undefined" && response.headers.get("X-Taesks-Offline") === "1") reportCachedRead(response.headers.get("X-Taesks-Cached-At"));
  if (!response.ok) {
    const body = await response.json().catch(() => null) as ApiErrorBody | null;
    throw new ApiClientError(body?.error?.message || "The request could not be completed.", response.status, body?.error?.code || "HTTP_ERROR", body?.error?.correlationId, body?.error?.details);
  }
  const value = await response.json() as T;
  if (response.headers.get("X-Taesks-Offline") === "1" && value && typeof value === "object") cachedResponses.add(value);
  return value;
}
export function localMutation(action: LocalMutation) { return apiRequest<{ result: unknown; snapshot: LocalSnapshot }>("/api/local", { method: "POST", body: JSON.stringify(action) }); }
