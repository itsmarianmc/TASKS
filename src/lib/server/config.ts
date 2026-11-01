import "server-only";
import path from "node:path";
import { DEFAULT_TIMEZONE, MAX_UPLOAD_BYTES, type PublicConfig } from "@/lib/public-config";
import { geminiStatus } from "./ai/config";

export function dataDirectory() { return path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || path.join(process.cwd(), "data")); }
export function publicConfig(): PublicConfig {
  const timezone = process.env.APP_TIMEZONE || DEFAULT_TIMEZONE;
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); }
  catch { throw new Error("APP_TIMEZONE must be a valid IANA timezone."); }
  return { timezone, maxUploadBytes: MAX_UPLOAD_BYTES, appName: "TÆSKS", aiFallback: geminiStatus() };
}

export async function localizedConfig(): Promise<PublicConfig> {
  const { configuredCatalogs } = await import("./catalogs");
  return { ...publicConfig(), catalogs: await configuredCatalogs() };
}
