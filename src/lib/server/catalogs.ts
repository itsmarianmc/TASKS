import "server-only";
import { createHash } from "node:crypto";
import bundle from "../generated/bundled-catalogs.json";
import { compatibleCatalogPair, normalizeLanguage, type Catalogs, type LanguageCatalog, type DateCatalog } from "@/lib/catalogs";

export const CATALOG_MAX_BYTES = 256 * 1024;
export const CATALOG_TIMEOUT_MS = 2500;
export const CATALOG_REFRESH_MS = 30 * 60_000;
export const REPOSITORY_API = "https://api.github.com/repos/itsmarianmc/T-SKS";
const MAX_EXTERNAL = 16, MAX_REPOSITORY = 32, CONCURRENCY = 4;
class CatalogReadError extends Error {}
export function catalogUrls(value = ""): string[] { return [...new Set(value.split(",").map(url => url.trim()).filter(Boolean))].slice(0, MAX_EXTERNAL); }
export function catalogFolder(value: string): URL {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || /\/(?:language|date-phrases)\.json\/?$/i.test(url.pathname)) throw new Error();
    url.pathname = url.pathname.replace(/\/+$/, "") + "/";
    return url;
  } catch { throw new CatalogReadError("Use an HTTP(S) folder URL without credentials, query or fragment."); }
}
export const externalSourceId = (folder: URL) => createHash("sha256").update(folder.href).digest("hex").slice(0, 20);
async function fetchJson(url: string, fetcher: typeof fetch, maxBytes = CATALOG_MAX_BYTES) {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new CatalogReadError("The request timed out.")); }, CATALOG_TIMEOUT_MS); });
  const work = async () => {
    const response = await fetcher(url, { signal: controller.signal, cache: "no-store", redirect: "error", credentials: "omit", headers: { Accept: "application/vnd.github+json", "User-Agent": "TAESKS-language-discovery" } });
    if (!response.ok) throw new CatalogReadError(response.status === 403 || response.status === 429 ? "The translation service is rate limited; retrying later." : "The translation service is unavailable.");
    if (!response.body) throw new CatalogReadError("The response has no JSON body.");
    if (Number(response.headers.get("content-length")) > maxBytes) throw new CatalogReadError("The response exceeds its size limit.");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) throw new CatalogReadError("The response exceeds its size limit.");
      chunks.push(part.value);
    }
    const buffer = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)); }
    catch { throw new CatalogReadError("The response is not valid UTF-8 JSON."); }
  };
  try { return await Promise.race([work(), deadline]); }
  finally { clearTimeout(timer!); void reader?.cancel().catch(() => {}); }
}
type Pair = ReturnType<typeof compatibleCatalogPair>;
type SourcePair = { language: LanguageCatalog; date: DateCatalog };
function sourced(pair: Pair, origin: "repository" | "external", source: string, sourceOrder?: number): SourcePair {
  const metadata = { id: `${origin === "repository" ? "repo" : `external:${source}`}:${pair.language.lang}`, origin, ...(sourceOrder === undefined ? {} : { sourceOrder }) };
  return { language: { ...pair.language, ...metadata }, date: { ...pair.date, ...metadata } };
}
async function mapBounded<T, R>(values: T[], work: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const result: R[] = []; let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, values.length) }, async () => {
    while (next < values.length) { const index = next++; result[index] = await work(values[index], index); }
  }));
  return result;
}
async function readPair(folder: URL, fetcher: typeof fetch, expected?: string): Promise<Pair> {
  const ui = await fetchJson(new URL("language.json", folder).href, fetcher);
  const dates = await fetchJson(new URL("date-phrases.json", folder).href, fetcher);
  return compatibleCatalogPair(ui, dates, expected);
}
function safeReason(error: unknown) { return error instanceof CatalogReadError ? error.message : "Invalid, incompatible or unavailable translation pair."; }

export async function loadCatalogs(folders = "", fetcher: typeof fetch = fetch): Promise<Catalogs> {
  const result: Catalogs = { languages: [], dates: [], diagnostics: [] };
  if (folders.split(",").filter(value => value.trim()).length > MAX_EXTERNAL) result.diagnostics.push("External translations: only the first 16 folders are loaded.");
  const pairs = await mapBounded(catalogUrls(folders), async (value, index) => {
    try { const folder = catalogFolder(value); return sourced(await readPair(folder, fetcher), "external", externalSourceId(folder), index + 1); }
    catch (error) { result.diagnostics.push(`External translation ${index + 1}: ${safeReason(error)}`); return null; }
  });
  for (const pair of pairs) if (pair) { result.languages.push(pair.language); result.dates.push(pair.date); }
  return result;
}

/** Process-owned JSON index and last-good cache. No runtime filesystem writes. */
export function createCatalogManager({ folders = "", fetcher = fetch, now = Date.now, bundled = bundle }: { folders?: string; fetcher?: typeof fetch; now?: () => number; bundled?: { folder: string; language: unknown; date: unknown }[] } = {}) {
  const repository = new Map<string, SourcePair>();
  for (const entry of bundled) { const pair = compatibleCatalogPair(entry.language, entry.date, entry.folder); repository.set(pair.language.lang, sourced(pair, "repository", "")); }
  const external = new Map<string, SourcePair>();
  let diagnostics: string[] = [], expires = 0, pending: Promise<void> | undefined;
  let index: { revision: string | null; languages: string[] } = { revision: null, languages: [...repository.keys()] };
  function snapshot(): Catalogs {
    const pairs = [...external.values()].sort((a, b) => (a.language.sourceOrder ?? 0) - (b.language.sourceOrder ?? 0)).concat([...repository.values()]);
    return { languages: pairs.map(pair => pair.language), dates: pairs.map(pair => pair.date), diagnostics: [...diagnostics] };
  }
  async function refresh() {
    if (pending) return pending;
    if (now() < expires) return;
    expires = now() + CATALOG_REFRESH_MS;
    pending = (async () => {
      const messages: string[] = [];
      const loaded = await loadCatalogs(folders, fetcher);
      for (const language of loaded.languages) external.set(language.id!.split(":")[1], { language, date: loaded.dates.find(date => date.id === language.id)! });
      messages.push(...loaded.diagnostics);
      try {
        const commit = await fetchJson(`${REPOSITORY_API}/commits/main`, fetcher) as { sha?: string };
        if (!commit || !/^[a-f0-9]{40}$/.test(commit.sha ?? "")) throw new Error();
        // Pin listing and both known files to one main commit.
        const entries = await fetchJson(`${REPOSITORY_API}/contents/public/locales?ref=${commit.sha}`, fetcher, 1024 * 1024) as { type: string; name: string }[];
        if (!Array.isArray(entries) || entries.length > 1000 || entries.some(entry => !entry || typeof entry.name !== "string" || typeof entry.type !== "string")) throw new Error();
        const languages = entries.filter(entry => entry.type === "dir" && /^[a-zA-Z0-9-]+$/.test(entry.name) && normalizeLanguage(entry.name)).slice(0, MAX_REPOSITORY).map(entry => entry.name);
        if (entries.filter(entry => entry.type === "dir").length > MAX_REPOSITORY) messages.push("Repository translations: only the first 32 language folders are loaded.");
        if (index.revision !== commit.sha) {
          const pairs = await mapBounded(languages, async (lang, position) => {
            try { return sourced(await readPair(new URL(`https://raw.githubusercontent.com/itsmarianmc/T-SKS/${commit.sha}/public/locales/${lang}/`), fetcher, lang), "repository", ""); }
            catch (error) { messages.push(`Repository translation ${position + 1}: ${safeReason(error)}`); return null; }
          });
          const keep = new Set([...bundled.map(entry => normalizeLanguage(entry.folder)), ...languages.map(normalizeLanguage)]);
          for (const lang of repository.keys()) if (!keep.has(lang)) repository.delete(lang);
          for (const pair of pairs) if (pair) repository.set(pair.language.lang, pair);
          index = { revision: pairs.every(Boolean) ? commit.sha! : null, languages };
        }
      } catch (error) { messages.push(`Repository discovery: ${safeReason(error)}`); }
      diagnostics = messages;
    })().finally(() => { pending = undefined; });
    return pending;
  }
  return { snapshot, refresh, index: () => JSON.parse(JSON.stringify(index)) as typeof index };
}
let active: { key: string; manager: ReturnType<typeof createCatalogManager>; timer: ReturnType<typeof setInterval> } | undefined;
export function configuredCatalogs(): Promise<Catalogs> {
  const key = process.env.TRANSLATION_FOLDER_URLS ?? "";
  if (!active || active.key !== key) {
    if (active) clearInterval(active.timer);
    const manager = createCatalogManager({ folders: key });
    const timer = setInterval(() => { void manager.refresh().catch(() => {}); }, CATALOG_REFRESH_MS);
    timer.unref(); active = { key, manager, timer };
  }
  void active.manager.refresh().catch(() => {});
  const result = active.manager.snapshot();
  if (process.env.LANGUAGE_JSON_URL || process.env.SHORT_DATES_JSON_URL) result.diagnostics.push("Legacy translation variables are ignored. Migrate to TRANSLATION_FOLDER_URLS; see the catalog documentation.");
  return Promise.resolve(result);
}
