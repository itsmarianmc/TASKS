"use client";
import { createContext, useContext, useMemo, useEffect, type ReactNode } from "react";
import { useConfig, useLocal } from "@/lib/queries";
import { catalogId, selectLanguage } from "@/lib/catalogs";
import { createTranslator, englishCatalog } from "@/lib/translation";
import type { PublicConfig } from "@/lib/public-config";
import type { LocalSnapshot } from "@/lib/types";

const fallback = { ...createTranslator(), locale: "en", selection: "en", languages: [englishCatalog], dateCatalog: undefined as import("@/lib/catalogs").DateCatalog | undefined };
const LocalizationContext = createContext(fallback);
export function LocalizationProvider({ children, initialConfig, initialLocal }: { children: ReactNode; initialConfig?: PublicConfig; initialLocal?: LocalSnapshot }) {
  // AppShell owns the ordered startup read. This observer must not start config early.
  const config = useConfig(initialConfig, false), local = useLocal(initialLocal);
  const catalogs = config.data?.catalogs;
  const preferred = config.data?.preferredLanguages;
  const saved = local.data?.preferences.language;
  const value = useMemo(() => {
    const available = catalogs?.languages.length ? catalogs.languages : [englishCatalog];
    const selection = selectLanguage(available, saved, preferred);
    const languages = available.some(value => catalogId(value) === selection) ? available : [...available, englishCatalog];
    const selected = languages.find(value => catalogId(value) === selection) ?? englishCatalog;
    return { ...createTranslator(selected), selection, locale: selected.lang, languages, dateCatalog: catalogs?.dates.find(value => catalogId(value) === selection) };
  }, [catalogs, saved, preferred]);
  useEffect(() => {
    document.documentElement.lang = value.locale;
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) void navigator.serviceWorker.getRegistration().then(registration => registration?.update()).catch(() => {});
  }, [value.selection, value.locale, catalogs]);
  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}
export function useTranslation() { return useContext(LocalizationContext); }
