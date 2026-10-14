/** Web Locks serialize tabs. IndexedDB read/write transactions provide an atomic fallback. */
async function fallbackClaim(key: string): Promise<boolean> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("taesks-reminder-delivery", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("claims"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try { return await new Promise<boolean>((resolve, reject) => {
    const transaction = db.transaction("claims", "readwrite"); const store = transaction.objectStore("claims"); const request = store.get(key); let claimed = false;
    request.onsuccess = () => { if (!request.result || request.result < Date.now()) { store.put(Date.now() + 30_000, key); claimed = true; } };
    transaction.oncomplete = () => resolve(claimed); transaction.onerror = () => reject(transaction.error);
  }); } finally { db.close(); }
}
export async function deliverReminderOnce(key: string, show: () => Promise<void>, storage: Storage = localStorage) {
  const marker = `taesks.reminder-shown.${key}`;
  const deliver = async () => { if (storage.getItem(marker)) return false; await show(); storage.setItem(marker, new Date().toISOString()); return true; };
  if (navigator.locks) return navigator.locks.request(`taesks-reminder:${key}`, deliver);
  if (!(await fallbackClaim(key))) return false;
  return deliver();
}
