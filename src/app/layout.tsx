import { localizedConfig } from "@/lib/server/config";
import { repository } from "@/lib/server/repository";
import { catalogId, selectLanguage } from "@/lib/catalogs";
import { headers } from "next/headers";
import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = { title: "TÆSKS", description: "Tasks, notes and projects.", applicationName: "TÆSKS", appleWebApp: { capable: true, title: "TÆSKS", statusBarStyle: "default" }, icons: { icon: "/icons/app-icon.svg", apple: "/icons/apple-touch-icon.png" } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f4f7f5" }, { media: "(prefers-color-scheme: dark)", color: "#101514" }] };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [config, local, requestHeaders] = await Promise.all([localizedConfig(), Promise.resolve().then(() => repository().snapshot()).catch(() => undefined), headers()]);
  const initialConfig = { ...config, preferredLanguages: (requestHeaders.get("accept-language") ?? "en").split(",").map(value => value.split(";")[0].trim()) };
  const selection = selectLanguage(config.catalogs?.languages ?? [], local?.preferences.language);
  const language = config.catalogs?.languages.find(value => catalogId(value) === selection)?.lang ?? "en";
  return <html lang={language}><head><link rel="stylesheet" href="https://static.itsmarian.dev/fonts/font-awesome-v7.2.0/css/all.min.css" precedence="sidebar-icons" crossOrigin="anonymous" /></head><body><Providers initialConfig={initialConfig} initialLocal={local}>{children}</Providers></body></html>;
}
