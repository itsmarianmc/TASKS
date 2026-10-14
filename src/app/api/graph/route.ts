import { notion } from "@/lib/server/notion-service";
import { errorResponse, jsonResponse } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const adapter = await notion();
    const query = new URL(request.url).searchParams;
    if (query.get("refresh") === "1") return jsonResponse(await adapter.readGraph(true));
    const since = query.get("since");
    if (query.get("startup") === "1") return jsonResponse(await adapter.readGraphSync(since, true));
    return jsonResponse(since ? await adapter.readGraphSync(since) : await adapter.readGraph());
  }
  catch (error) { return errorResponse(error, "notion.graph"); }
}
