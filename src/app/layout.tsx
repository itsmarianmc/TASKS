import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = { title: "TÆSKS", description: "Tasks, notes and projects.", applicationName: "TÆSKS", appleWebApp: { capable: true, title: "TÆSKS", statusBarStyle: "default" }, icons: { icon: "/icons/app-icon.svg", apple: "/icons/apple-touch-icon.png" } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f4f7f5" }, { media: "(prefers-color-scheme: dark)", color: "#101514" }] };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><head><link rel="stylesheet" href="https://static.itsmarian.dev/fonts/font-awesome-v7.2.0/css/all.min.css" precedence="sidebar-icons" crossOrigin="anonymous" /></head><body><Providers>{children}</Providers></body></html>;
}
