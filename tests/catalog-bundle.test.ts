import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import english from "../public/locales/en/language.json";
import englishDates from "../public/locales/en/date-phrases.json";

it("generates a bundle from an additional actual language folder without a manifest entry", async () => {
  const root = await mkdtemp(join(process.cwd(), ".qa-catalog-bundle-"));
  try {
    const locales = join(root, "locales");
    for (const lang of ["en", "de", "fr"]) {
      const folder = join(locales, lang); await mkdir(folder, { recursive: true });
      await writeFile(join(folder, "language.json"), JSON.stringify({ ...english, lang }));
      await writeFile(join(folder, "date-phrases.json"), JSON.stringify({ ...englishDates, lang }));
    }
    const output = join(root, "bundle.json");
    execFileSync(process.execPath, ["scripts/generate-catalogs.mjs", locales, output], { cwd: process.cwd(), stdio: "pipe" });
    const bundle = JSON.parse(await readFile(output, "utf8"));
    expect(bundle.map((entry: { folder: string }) => entry.folder)).toEqual(["de", "en", "fr"]);
    expect(bundle[2].language.lang).toBe("fr");
  } finally {
    if (!resolve(root).startsWith(resolve(process.cwd()) + "\\.qa-catalog-bundle-") && !resolve(root).startsWith(resolve(process.cwd()) + "/.qa-catalog-bundle-")) throw new Error("Unexpected fixture path");
    await rm(root, { recursive: true, force: true });
  }
});
