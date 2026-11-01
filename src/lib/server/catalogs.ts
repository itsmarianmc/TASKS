import "server-only";
import english from "../../../public/locales/en/language.json";
import { dateCatalogSchema, languageCatalogSchema, type Catalogs } from "@/lib/catalogs";

export const CATALOG_MAX_BYTES = 256 * 1024;
export const CATALOG_TIMEOUT_MS = 2500;
class CatalogReadError extends Error {}
export function catalogUrls(value = ""): string[] { return [...new Set(value.split(",").map(url => url.trim()).filter(Boolean))].slice(0, 16); }
function validUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    return url;
  } catch { throw new CatalogReadError("Use an HTTP(S) URL without embedded credentials."); }
}
async function fetchJson(url: string, fetcher: typeof fetch) {
  validUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetcher(url, { signal: controller.signal, cache: "no-store", redirect: "error" });
    if (!response.ok) throw new CatalogReadError(`HTTP request failed (${response.status}).`);
    if (!response.body) throw new CatalogReadError("The response has no JSON body.");
    if (Number(response.headers.get("content-length")) > CATALOG_MAX_BYTES) throw new CatalogReadError("The response exceeds 256 KiB.");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > CATALOG_MAX_BYTES) throw new CatalogReadError("The response exceeds 256 KiB.");
      chunks.push(part.value);
    }
    const buffer = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)); }
    catch { throw new CatalogReadError("The response is not valid UTF-8 JSON."); }
  } catch (error) {
    if (controller.signal.aborted) throw new CatalogReadError("The request timed out.");
    throw error;
  } finally { clearTimeout(timer); await reader?.cancel().catch(() => {}); }
}
export async function loadCatalogs(languageUrls = "", dateUrls = "", fetcher: typeof fetch = fetch): Promise<Catalogs> {
  const result: Catalogs = { languages: [], dates: [], diagnostics: [] };
  const entries = [...catalogUrls(languageUrls).map(url => ({ url, kind: "language" as const })), ...catalogUrls(dateUrls).map(url => ({ url, kind: "date" as const }))];
  for (const [kind, urls] of [["language", languageUrls], ["date", dateUrls]]) if (urls.split(",").filter(url => url.trim()).length > 16) result.diagnostics.push(`${kind} catalogs: at most 16 configured URLs are loaded.`);
  const loaded = await Promise.all(entries.map(async ({ url, kind }, index) => {
    try {
      const json = await fetchJson(url, fetcher);
      const parsed = (kind === "language" ? languageCatalogSchema : dateCatalogSchema).safeParse(json);
      if (!parsed.success) throw new CatalogReadError("Invalid or unsupported catalog schema. Check version, metadata, aliases and value types.");
      return { index, kind, data: parsed.data };
    }
    catch (error) { return { index, kind, data: null, reason: error instanceof CatalogReadError ? error.message : "Unavailable: network failure or redirect rejected." }; }
  }));
  for (const entry of loaded) {
    const label = `${entry.kind} catalog ${entry.index + 1}`;
    if (!entry.data) { result.diagnostics.push(`Catalog ${entry.index + 1} (${entry.kind}): ${entry.reason}`); continue; }
    const target = entry.kind === "language" ? result.languages : result.dates;
    if (target.some(value => value.lang === entry.data!.lang)) { result.diagnostics.push(`${label}: duplicate language ${entry.data.lang}; first valid catalog wins.`); continue; }
    if (entry.kind === "language") {
      const language = languageCatalogSchema.parse(entry.data);
      result.languages.push({ ...language, strings: Object.fromEntries(Object.entries(language.strings).filter(([key]) => Object.hasOwn(english.strings, key))) });
    }
    else result.dates.push(dateCatalogSchema.parse(entry.data));
  }
  result.dates = result.dates.filter(date => {
    if (result.languages.some(language => language.lang === date.lang)) return true;
    result.diagnostics.push(`Date catalog ${date.lang}: no matching language catalog; ignored.`); return false;
  });
  for (const language of result.languages) if (!result.dates.some(date => date.lang === language.lang)) result.diagnostics.push(`Language ${language.lang}: no matching date catalog; built-in DE/EN parsing remains available.`);
  return result;
}
let cache: { key: string; expires: number; promise: Promise<Catalogs> } | undefined;
export function configuredCatalogs(): Promise<Catalogs> {
  const language = process.env.LANGUAGE_JSON_URL ?? "", dates = process.env.SHORT_DATES_JSON_URL ?? "";
  const key = JSON.stringify([language, dates]);
  if (!cache || cache.key !== key || cache.expires < Date.now()) cache = { key, expires: Date.now() + 300_000, promise: loadCatalogs(language, dates) };
  return cache.promise;
}
