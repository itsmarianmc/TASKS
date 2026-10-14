"use client";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { emptyMutationStatus, mutationStatusKey, optimisticCache, type MutationStatus } from "@/lib/optimistic";
import { useOnline } from "@/lib/connectivity";

export function MutationFeedback() {
  const client = useQueryClient(), cache = optimisticCache(client), online = useOnline();
  const { data = emptyMutationStatus } = useQuery<MutationStatus>({ queryKey: mutationStatusKey, queryFn: () => emptyMutationStatus, enabled: false, initialData: emptyMutationStatus });
  useEffect(() => {
    const pending = data.operations.length;
    if (!pending) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [data.operations.length]);
  return <>
    {!!data.operations.length && <div className="mutation-sync" role="status">{data.operations.some(op => op.state !== "pending") ? <>{data.operations.filter(op => op.state !== "pending").length} unsynced {online && <button className="text-button" onClick={async () => { for (const op of data.operations) if (op.state !== "pending" && op.retryable) await cache.retry(op.id); }}>Retry pending changes</button>}</> : "syncing…"}</div>}
    {!!data.errors.length && <div className="mutation-toasts" aria-live="polite" aria-relevant="additions">
      {data.errors.map(error => <div className="mutation-toast" key={error.id} role="alert"><span>{error.message}</span>{error.retryable && <button className="text-button" disabled={!online} onClick={() => void cache.retry(error.id)}>Retry</button>}<button className="icon-button" aria-label="Dismiss error" onClick={() => cache.dismiss(error.id)}>×</button></div>)}
    </div>}
  </>;
}
