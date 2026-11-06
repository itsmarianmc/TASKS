import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compatibleCatalogPair, normalizeLanguage } from "../src/lib/catalogs.ts";

// Generated from folders, never maintained by translators. Runtime only reads the bundle.
const root = process.argv[2] ? pathToFileURL(resolve(process.argv[2]) + "/") : new URL("../public/locales/", import.meta.url);
const index = [];
for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory()) continue;
  if (!normalizeLanguage(entry.name)) throw new Error(`Invalid locale folder: ${entry.name}`);
  const folder = new URL(`${entry.name}/`, root);
  const [ui, dates] = await Promise.all(["language.json", "date-phrases.json"].map(async name => {
    const bytes = await readFile(new URL(name, folder));
    if (bytes.length > 256 * 1024) throw new Error(`Catalog exceeds 256 KiB: ${entry.name}/${name}`);
    return JSON.parse(bytes.toString("utf8"));
  }));
  index.push({ folder: entry.name, ...compatibleCatalogPair(ui, dates, entry.name) });
}
if (!["en", "de"].every(lang => index.some(entry => entry.language.lang === lang))) throw new Error("English and German bundles are required.");
const output = process.argv[3] ? pathToFileURL(resolve(process.argv[3])) : new URL("../src/lib/generated/bundled-catalogs.json", import.meta.url);
await mkdir(new URL("./", output), { recursive: true });
await writeFile(output, JSON.stringify(index) + "\n");
console.log(`Bundled ${index.length} repository languages.`);
