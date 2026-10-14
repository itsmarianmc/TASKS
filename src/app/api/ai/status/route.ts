import { geminiStatus } from "@/lib/server/ai/config";
import { jsonResponse } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() { return jsonResponse(geminiStatus()); }
