import { notion } from "@/lib/server/notion-service";
import { errorResponse, jsonResponse } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return jsonResponse(await (await notion()).publicSchema(new URL(request.url).searchParams.get("refresh") === "1")); }
  catch (error) { return errorResponse(error, "notion.schema"); }
}
