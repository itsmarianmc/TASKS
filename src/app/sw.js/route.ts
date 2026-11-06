import { readFile } from "node:fs/promises";
import path from "node:path";
import { configuredCatalogs } from "@/lib/server/catalogs";
import { repository } from "@/lib/server/repository";
import { catalogId, selectLanguage } from "@/lib/catalogs";
import { createTranslator } from "@/lib/translation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const source = await readFile(path.join(/* turbopackIgnore: true */ process.cwd(), "public", "service-worker.js"), "utf8");
  const [catalogs, preferences] = await Promise.all([configuredCatalogs(), Promise.resolve().then(() => repository().getPreferences()).catch(() => undefined)]);
  const language = selectLanguage(catalogs.languages, preferences?.language, (request?.headers.get("accept-language") ?? "en").split(",").map(value => value.split(";")[0]));
  const { t } = createTranslator(catalogs.languages.find(value => catalogId(value) === language));
  const localized = source.replace('/*__TAESKS_REMINDER_COPY__*/ { title: "TÆSKS / reminder", body: "A reminder is due. Open TÆSKS." }', JSON.stringify({ title: t("reminders.title"), body: t("reminders.body") }));
  return new Response(localized.replace("__TAESKS_BUILD__", process.env.TAESKS_SW_VERSION || "development"), { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache, no-store, must-revalidate", "Service-Worker-Allowed": "/", "Vary": "Accept-Language" } });
}
