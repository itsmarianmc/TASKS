"use client";
import { useSyncExternalStore } from "react";
let cachedAt: string | null = null;
let cachedRevision = 0;
function subscribe(callback: () => void) { window.addEventListener("online", callback); window.addEventListener("offline", callback); window.addEventListener("taesks-offline-read", callback); return () => { window.removeEventListener("online", callback); window.removeEventListener("offline", callback); window.removeEventListener("taesks-offline-read", callback); }; }
export function reportCachedRead(at: string | null) { cachedAt = at; if (at !== null) cachedRevision++; window.dispatchEvent(new Event("taesks-offline-read")); }
export function cachedReadRevision() { return cachedRevision; }
export function useOnline() { return useSyncExternalStore(subscribe, () => navigator.onLine, () => true); }
export function useCachedRead() { return useSyncExternalStore(subscribe, () => cachedAt, () => null); }
