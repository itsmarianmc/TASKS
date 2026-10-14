import { readFile } from "node:fs/promises";
import path from "node:path";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const source = await readFile(path.join(/* turbopackIgnore: true */ process.cwd(), "public", "service-worker.js"), "utf8");
  return new Response(source.replace("__TAESKS_BUILD__", process.env.TAESKS_SW_VERSION || "development"), { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache, no-store, must-revalidate", "Service-Worker-Allowed": "/" } });
}
