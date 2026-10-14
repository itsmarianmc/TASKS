/** Atomic IndexedDB lease fallback for browsers without Web Locks. */
import { clientId } from "./client-id";

export async function withBrowserLock<T>(name: string, work: () => Promise<T>): Promise<T | undefined> {
  if (navigator.locks) return navigator.locks.request(name, work);
  const owner = clientId();
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("taesks-browser-locks", 1); request.onupgradeneeded = () => request.result.createObjectStore("leases"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const lease = (release = false) => new Promise<boolean>((resolve, reject) => {
    const transaction = db.transaction("leases", "readwrite"); const store = transaction.objectStore("leases"); const read = store.get(name); let acquired = false;
    read.onsuccess = () => { const current = read.result as { owner: string; until: number } | undefined; if (current?.owner === owner || (!release && (!current || current.until < Date.now()))) { if (release) store.delete(name); else store.put({ owner, until: Date.now() + 60_000 }, name); acquired = true; } };
    transaction.oncomplete = () => resolve(acquired); transaction.onerror = () => reject(transaction.error);
  });
  if (!await lease()) { db.close(); return undefined; }
  const heartbeat = setInterval(() => { void lease().catch(() => {}); }, 20_000);
  try { return await work(); } finally { clearInterval(heartbeat); await lease(true); db.close(); }
}
