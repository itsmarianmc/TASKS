import type { NextConfig } from "next";
import { randomUUID } from "node:crypto";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["node:sqlite"],
  poweredByHeader: false,
  env: { TAESKS_SW_VERSION: randomUUID() },
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Content-Security-Policy", value: `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline' https://static.itsmarian.dev; img-src 'self' data: blob: https:; font-src 'self' data: https://static.itsmarian.dev; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'` },
    ] }, { source: "/sw.js", headers: [{ key: "Content-Type", value: "application/javascript; charset=utf-8" }, { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/" }, { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" }] }];
  },
};
export default nextConfig;
