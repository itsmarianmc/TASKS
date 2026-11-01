import english from "../../public/locales/en/language.json";
import { languageCatalogSchema, type LanguageCatalog } from "./catalogs";

export type TranslationKey = keyof typeof english.strings;
export const englishCatalog: LanguageCatalog = languageCatalogSchema.parse(english);
const sources = Object.entries(english.strings);
const bySource = new Map(sources.map(([key, value]) => [value, key]));
const templateSources = sources.filter(([, value]) => /\{p\d+\}/.test(value) && value.replace(/\{p\d+\}/g, "").length >= 8 && [...value.matchAll(/\{p\d+\}/g)].length <= 4 && !/\{p\d+\}\s*\{p\d+\}/.test(value)).sort((a, b) => b[1].replace(/\{p\d+\}/g, "").length - a[1].replace(/\{p\d+\}/g, "").length).map(([key, value]) => ({
  key, parts: value.split(/\{p\d+\}/), names: [...value.matchAll(/\{(p\d+)\}/g)].map(match => match[1]),
}));
function matchMessage(message: string, template: typeof templateSources[number]) {
  if (!message.startsWith(template.parts[0])) return null;
  let cursor = template.parts[0].length;
  const params: Record<string, string> = {};
  for (let i = 0; i < template.names.length; i++) {
    const literal = template.parts[i + 1];
    const last = i === template.names.length - 1;
    const end = last ? message.endsWith(literal) ? message.length - literal.length : -1 : message.indexOf(literal, cursor);
    if (end < cursor) return null;
    params[template.names[i]] = message.slice(cursor, end);
    cursor = end + literal.length;
  }
  return cursor === message.length ? params : null;
}
export function createTranslator(catalog?: LanguageCatalog) {
  const translate = (key: string, params: Record<string, string | number | null | undefined> = {}) => {
    const fallback = english.strings[key as TranslationKey] ?? key;
    const candidate = catalog?.strings[key];
    // A translation omitting or inventing placeholders is unusable; fall back per key.
    const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(",");
    const message = candidate && placeholders(candidate) === placeholders(fallback) ? candidate : fallback;
    return message.replace(/\{(\w+)\}/g, (token, name) => Object.hasOwn(params, name) ? String(params[name] ?? "") : token);
  };
  return {
    t: (key: TranslationKey, params?: Record<string, string | number | null | undefined>) => translate(key, params),
    /** Only application messages belong here. Never pass task titles, notes, or source content. */
    text: (message: string): string => {
      const exact = bySource.get(message);
      if (exact) return translate(exact);
      if (message.length > 8000) return message;
      for (const template of templateSources) {
        const params = matchMessage(message, template);
        if (params) return translate(template.key, params);
      }
      return message;
    },
  };
}
