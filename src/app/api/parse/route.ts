import { z } from "zod";
import { notion } from "@/lib/server/notion-service";
import { repository } from "@/lib/server/repository";
import { publicConfig } from "@/lib/server/config";
import { parseTaskCapture } from "@/lib/server/ai/fallback";
import { errorResponse, jsonResponse, validatedJson } from "@/lib/server/http";
import { configuredCatalogs } from "@/lib/server/catalogs";
import { selectLanguage } from "@/lib/catalogs";
import { idSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const requestSchema = z.object({ input: z.string().trim().min(1).max(10000),
  context: z.object({ projectId: idSchema.optional(), areaId: idSchema.optional() }).strict().default({}),
}).strict();
export async function POST(request: Request) {
  try {
    const body = await validatedJson(request, requestSchema);
    const [{ graph }, local] = await Promise.all([(await notion()).readGraph(), repository().snapshot()]);
    const catalogs = await configuredCatalogs();
    const language = selectLanguage(catalogs.languages, local.preferences.language, (request.headers.get("accept-language") ?? "en").split(",").map(value => value.split(";")[0]));
    return jsonResponse(await parseTaskCapture(body.input, graph, local.aliases, { ...body.context, timezone: publicConfig().timezone, literalQuotedText: local.preferences.literalQuotedText !== false, dateCatalog: catalogs.dates.find(value => value.lang === language) }, local.tags, request.signal));
  } catch (error) { return errorResponse(error, "capture.parse"); }
}
