"use client";
import { useLayoutEffect } from "react";
import type { Theme } from "@/lib/types";

export function ThemeSync({ theme }: { theme: Theme }) {
  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach(meta => { meta.content = document.documentElement.dataset.theme === "dark" ? "#101514" : "#f4f7f5"; });
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return null;
}
