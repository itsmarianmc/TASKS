import { z } from "zod";
import { draftSchema, idSchema } from "./schemas";
import type { InboxDraft, LocalSnapshot } from "./types";
import { localMutation } from "./api-client";
import { withBrowserLock } from "./browser-lock";
import { clientId } from "./client-id";

const PREFIX = "taesks.device-draft.";
const schema = z.object({ revision: z.uuid(), operation: z.enum(["save", "delete"]), draft: draftSchema.extend({ id: idSchema, createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }) }) });
export type DeviceDraft = z.infer<typeof schema>;
export function readDeviceDrafts(storage: Pick<Storage, "length" | "key" | "getItem"> = localStorage): DeviceDraft[] {
  const result: DeviceDraft[] = [];
  for (let i = 0; i < storage.length; i++) { const key = storage.key(i); if (!key?.startsWith(PREFIX)) continue; try { const parsed = schema.safeParse(JSON.parse(storage.getItem(key) ?? "null")); if (parsed.success && key === PREFIX + parsed.data.draft.id) result.push(parsed.data); } catch { /* An invalid storage entry is never sent. */ } }
  return result;
}
export function putDeviceDraft(draft: InboxDraft, operation: "save" | "delete" = "save", storage: Storage = localStorage) {
  const entry = schema.parse({ draft, operation, revision: clientId() });
  storage.setItem(PREFIX + draft.id, JSON.stringify(entry));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("taesks-device-drafts"));
  return entry;
}
export function acknowledgeDeviceDraft(entry: DeviceDraft, storage: Storage = localStorage) {
  const current = storage.getItem(PREFIX + entry.draft.id);
  if (current && JSON.parse(current).revision === entry.revision) storage.removeItem(PREFIX + entry.draft.id);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("taesks-device-drafts"));
}
export function mergeDeviceDrafts(local: LocalSnapshot, entries: DeviceDraft[]): LocalSnapshot {
  return { ...local, drafts: [...entries.filter(entry => entry.operation === "save").map(entry => entry.draft), ...local.drafts.filter(draft => !entries.some(entry => entry.draft.id === draft.id))] };
}
/** Same UUID across lost acknowledgements. Only a confirmed current revision is removed. */
export async function flushDeviceDrafts(onSnapshot: (snapshot: LocalSnapshot) => void, send = localMutation, storage: Storage = localStorage) {
  for (const entry of readDeviceDrafts(storage)) {
    const { createdAt: _created, updatedAt: _updated, ...draft } = entry.draft;
    const result = await send(entry.operation === "save" ? { action: "saveDraft", draft } : { action: "deleteDraft", id: draft.id });
    onSnapshot(result.snapshot); acknowledgeDeviceDraft(entry, storage);
  }
}
let running: Promise<void> | null = null;
export async function syncDeviceDrafts(onSnapshot: (snapshot: LocalSnapshot) => void) {
  if (!navigator.onLine) return;
  if (running) return running;
  const work = () => flushDeviceDrafts(onSnapshot);
  running = withBrowserLock("taesks-device-drafts", work).then(() => {}).finally(() => { running = null; });
  return running;
}
