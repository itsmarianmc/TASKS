// Controlled transport/clock for an isolated Docker test; never included in the image.
import { readFileSync } from "node:fs";
const english = JSON.parse(readFileSync("/app/public/locales/en/language.json", "utf8"));
const dates = JSON.parse(readFileSync("/app/public/locales/en/date-phrases.json", "utf8"));
const originalFetch = globalThis.fetch;
const originalInterval = globalThis.setInterval;
const originalNow = Date.now;
let revision = 0, elapsed = 0;
Date.now = () => originalNow() + elapsed;
globalThis.setInterval = (callback, delay, ...args) => originalInterval(delay === 1_800_000 ? () => {
  elapsed += 1_800_001; revision++; callback(...args);
} : callback, delay === 1_800_000 ? 1000 : delay, ...args);
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === "https://api.github.com/repos/itsmarianmc/T-SKS/commits/main") return Response.json({ sha: (revision ? "b" : "a").repeat(40) });
  if (url.startsWith("https://api.github.com/repos/itsmarianmc/T-SKS/contents/public/locales?")) return Response.json((revision ? ["en", "de", "fr"] : ["en", "de"]).map(name => ({ name, type: "dir" })));
  const match = /https:\/\/raw\.githubusercontent\.com\/itsmarianmc\/T-SKS\/[ab]{40}\/public\/locales\/(en|de|fr)\/(language|date-phrases)\.json$/.exec(url);
  const external = /^https:\/\/translation-fixture\.invalid\/de\/(language|date-phrases)\.json$/.exec(url);
  if (match || external) {
    const lang = match?.[1] ?? "de", kind = match?.[2] ?? external[1];
    return Response.json(kind === "language" ? { ...english, lang, name: lang === "fr" ? "French" : lang === "de" ? "German" : "English", locName: lang === "fr" ? "Français" : lang === "de" ? "Deutsch" : "English" } : { ...dates, lang });
  }
  return originalFetch(input, init);
};
