import "server-only";
import { createHash } from "node:crypto";
import { createNotionAdapter, notionConfig } from "./notion";
import { repository } from "./repository";

let cached: { fingerprint: string; adapter: ReturnType<typeof createNotionAdapter> } | null = null;
export async function notion() {
  const repo = repository();
  const config = notionConfig(await repo.getNotionMapping());
  const fingerprint = JSON.stringify(config);
  if (!cached || cached.fingerprint !== fingerprint) {
    const cacheKey = createHash("sha256").update(fingerprint).digest("hex");
    cached = { fingerprint, adapter: createNotionAdapter(config, undefined, { graphSnapshot: repo.getNotionGraphCache(cacheKey), persistGraphSnapshot: snapshot => repo.saveNotionGraphCache(cacheKey, snapshot) }) };
  }
  return cached.adapter;
}

const syncGlobal = globalThis as typeof globalThis & { taesksNotionWarmup?: boolean };
export function startNotionBackgroundSync() {
  if (syncGlobal.taesksNotionWarmup) return;
  syncGlobal.taesksNotionWarmup = true;
  void (async () => {
    const refresh = async () => { try { await (await notion()).refreshGraph(); } catch { /* Keep the last saved graph and retry on the next interval. */ } };
    await refresh();
    const timer = setInterval(() => { void refresh(); }, 30_000);
    timer.unref?.();
  })();
}
