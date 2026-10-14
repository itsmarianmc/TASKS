import { databaseHealth } from "@/lib/server/db";
import { jsonResponse } from "@/lib/server/http";
import { geminiStatus } from "@/lib/server/ai/config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  let healthy = false;
  try { healthy = !!databaseHealth(); } catch { healthy = false; }
  return jsonResponse({ status: healthy ? "ok" : "error", services: {
    localDatabase: healthy ? "ok" : "error",
    notion: process.env.NOTION_TOKEN && process.env.NOTION_TASKS_DATABASE_ID && process.env.NOTION_PROJECTS_DATABASE_ID && process.env.NOTION_AREAS_DATABASE_ID ? "configured" : "disabled",
    github: process.env.GITHUB_TOKEN ? "configured" : "disabled",
    contact: process.env.CONTACT_API_BASE_URL ? "configured" : "default",
    gemini: geminiStatus().status === "ready" ? "configured" : geminiStatus().status,
  } }, healthy ? 200 : 503);
}
