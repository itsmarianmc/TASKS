"use client";
import { createContext, useContext, useMemo, useEffect, type ReactNode } from "react";
import { useConfig, useLocal } from "@/lib/queries";
import { selectLanguage } from "@/lib/catalogs";
import { createTranslator, englishCatalog } from "@/lib/translation";
import type { PublicConfig } from "@/lib/public-config";
import type { LocalSnapshot } from "@/lib/types";

const fallback = { ...createTranslator(), locale: "en", languages: [englishCatalog], dateCatalog: undefined as import("@/lib/catalogs").DateCatalog | undefined };
const LocalizationContext = createContext(fallback);
export function LocalizationProvider({ children, initialConfig, initialLocal }: { children: ReactNode; initialConfig?: PublicConfig; initialLocal?: LocalSnapshot }) {
  const config = useConfig(initialConfig), local = useLocal(initialLocal);
  const catalogs = config.data?.catalogs;
  const preferred = config.data?.preferredLanguages;
  const saved = local.data?.preferences.language;
  const value = useMemo(() => {
    const available = catalogs?.languages.length ? catalogs.languages : [englishCatalog];
    const locale = selectLanguage(available, saved, preferred);
    const languages = available.some(value => value.lang === locale) ? available : [...available, englishCatalog];
    return { ...createTranslator(languages.find(value => value.lang === locale)), locale, languages, dateCatalog: catalogs?.dates.find(value => value.lang === locale) };
  }, [catalogs, saved, preferred]);
  useEffect(() => {
    document.documentElement.lang = value.locale;
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) void navigator.serviceWorker.getRegistration().then(registration => registration?.update()).catch(() => {});
  }, [value.locale]);
  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}
export function useTranslation() { return useContext(LocalizationContext); }
