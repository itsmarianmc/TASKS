import { localizedConfig } from "@/lib/server/config";
import { jsonResponse, errorResponse } from "@/lib/server/http";
export const runtime = "nodejs";
export async function GET(request: Request) { try { return jsonResponse({ ...await localizedConfig(), preferredLanguages: (request.headers.get("accept-language") ?? "en").split(",").map(value => value.split(";")[0].trim()) }); } catch (error) { return errorResponse(error, "config.read"); } }
