import "server-only";
import { z } from "zod";
import { idSchema, isoDateSchema, prioritySchema, recurrenceSchema } from "@/lib/schemas";

// The existing ParseResult shape is used throughout; no parallel task model.
export const geminiTaskSchema = z.object({
  title: z.string().trim().min(1).max(2000),
  projectId: idSchema.nullable(),
  areaId: idSchema.nullable(),
  dates: z.object({ start: isoDateSchema.nullable(), end: isoDateSchema.nullable() }).strict(),
  tags: z.array(z.string().trim().min(1).max(64)).max(50),
  priority: prioritySchema,
  recurrenceRule: recurrenceSchema.nullable(),
  confidence: z.number().min(0).max(1),
}).strict();

export function taskResponseSchema(projectIds: string[], areaIds: string[], tags: string[]) {
  const schema = z.toJSONSchema(geminiTaskSchema);
  // Constrain the model, then independently validate these same IDs after Zod.
  const nullableIds = (values: string[]) => ({ anyOf: [
    ...(values.length ? [{ type: "string", enum: values }] : []), { type: "null" },
  ] });
  return { ...schema, properties: { ...schema.properties,
    projectId: nullableIds(projectIds), areaId: nullableIds(areaIds),
    tags: { type: "array", maxItems: 50, items: tags.length ? { type: "string", enum: tags } : { type: "string" }, ...(tags.length ? {} : { maxItems: 0 }) },
  } };
}
