import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { id: "/", name: "TÆSKS", short_name: "TÆSKS", description: "Tasks, notes and projects.", start_url: "/", scope: "/", display: "standalone", background_color: "#101514", theme_color: "#101514", icons: [{ src: "/icons/app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }, { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }, { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }] };
}
