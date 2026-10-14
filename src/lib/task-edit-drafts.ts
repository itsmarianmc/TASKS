import { z } from "zod";
import { idSchema, isoDateSchema } from "./schemas";
import type { Task } from "./types";
const fieldsSchema = z.object({ title: z.string().max(2000), areaId: idSchema.nullable(), projectId: idSchema.nullable(), dates: z.object({ start: isoDateSchema.nullable(), end: isoDateSchema.nullable() }), highlight: z.boolean() });
export type CoreFields = z.infer<typeof fieldsSchema>;
const draftSchema = z.object({ base: fieldsSchema, fields: fieldsSchema });
export const coreFields = (task: CoreFields): CoreFields => ({ title: task.title, areaId: task.areaId, projectId: task.projectId, dates: task.dates, highlight: task.highlight });
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function readTaskEdit(key: string, task: Task): CoreFields {
  try {
    const draft = draftSchema.safeParse(JSON.parse(localStorage.getItem(key) ?? "null"));
    if (draft.success) return { ...coreFields(task), ...Object.fromEntries(Object.entries(draft.data.fields).filter(([field, value]) => !equal(value, draft.data.base[field as keyof CoreFields]))) };
  } catch { /* An invalid device copy cannot replace the current task. */ }
  return coreFields(task);
}
export function storeTaskEdit(key: string, base: CoreFields, fields: CoreFields) { localStorage.setItem(key, JSON.stringify({ base: coreFields(base), fields: coreFields(fields) })); }
export function reconcileTaskEdit(key: string, submitted: CoreFields, confirmed: CoreFields) {
  try {
    const parsed = draftSchema.safeParse(JSON.parse(localStorage.getItem(key) ?? "null")); if (!parsed.success) return;
    const fields = { ...parsed.data.fields, ...Object.fromEntries(Object.entries(confirmed).filter(([field]) => equal(parsed.data.fields[field as keyof CoreFields], submitted[field as keyof CoreFields]))) };
    if (equal(fields, coreFields(confirmed))) localStorage.removeItem(key); else storeTaskEdit(key, confirmed, fields);
  } catch { /* Keep the existing draft on storage failure. */ }
}
