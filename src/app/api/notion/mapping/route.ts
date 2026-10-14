import { notionMappingSchema } from "@/lib/schemas";
import { createNotionAdapter, notionConfig } from "@/lib/server/notion";
import { notion } from "@/lib/server/notion-service";
import { repository } from "@/lib/server/repository";
import { AppError, errorResponse, jsonResponse, validatedJson } from "@/lib/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const mapping = await validatedJson(request, notionMappingSchema);
    const adapter = createNotionAdapter(notionConfig(mapping));
    const schema = await adapter.publicSchema(true);
    const failure = schema.diagnostics.find(diagnostic => diagnostic.status === "error");
    if (failure) throw new AppError("NOTION_MAPPING_INVALID", failure.message, 422);
    const repo = repository();
    await repo.mutate({ action: "setNotionMapping", mapping });
    (await notion()).invalidate(true);
    return jsonResponse({ schema, snapshot: await repo.snapshot() });
  } catch (error) { return errorResponse(error, "notion.mapping.save"); }
}
