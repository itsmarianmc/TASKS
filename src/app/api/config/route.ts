import { publicConfig } from "@/lib/server/config";
import { jsonResponse, errorResponse } from "@/lib/server/http";
export const runtime = "nodejs";
export function GET() { try { return jsonResponse(publicConfig()); } catch (error) { return errorResponse(error, "config.read"); } }
