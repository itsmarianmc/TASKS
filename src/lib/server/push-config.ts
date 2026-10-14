import "server-only";
import { createECDH } from "node:crypto";
import type { PushPublicConfig } from "@/lib/push-contracts";

export function pushConfig(env: Record<string, string | undefined> = process.env) {
  const unavailable = (reason: string): { public: PushPublicConfig; vapid: null } => ({ public: { available: false, publicKey: null, reason }, vapid: null });
  const { APP_ORIGIN: origin, VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env;
  if (!publicKey || !privateKey || !subject) return unavailable("Push is not configured on this server.");
  try {
    const url = new URL(origin || "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") return unavailable("Push needs an HTTPS APP_ORIGIN on this server.");
    if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey) || !/^[A-Za-z0-9_-]{43}$/.test(privateKey)) return unavailable("The server push configuration is invalid.");
    const pair = createECDH("prime256v1"); pair.setPrivateKey(Buffer.from(privateKey, "base64url"));
    if (pair.getPublicKey().toString("base64url") !== publicKey) return unavailable("The server push configuration is invalid.");
    const contact = new URL(subject);
    if (!((contact.protocol === "mailto:" && /^[^\s@]+@[^\s@]+$/.test(contact.pathname)) || (contact.protocol === "https:" && !contact.username && !contact.password && contact.hostname !== "localhost"))) return unavailable("The server push contact is invalid.");
    return { public: { available: true, publicKey, reason: null } satisfies PushPublicConfig, vapid: { publicKey, privateKey, subject } };
  } catch { return unavailable("The server push configuration is invalid."); }
}
