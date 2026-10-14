import { z } from "zod";

// Restrict outbound sends to browser vendors, never client-selected HTTP hosts.
export function supportedPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname;
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash && url.pathname.length > 1 &&
      (host.endsWith(".push.apple.com") || host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" || /^[a-z0-9-]+\.notify\.windows\.com$/.test(host));
  } catch { return false; }
}
const key = (bytes: number) => z.string().regex(/^[A-Za-z0-9_-]+$/).refine(value => {
  try { const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/")); return decoded.length === bytes && (bytes !== 65 || decoded.charCodeAt(0) === 4); } catch { return false; }
}, "Invalid subscription key.");
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().max(4096).refine(supportedPushEndpoint, "This browser push service is not supported."),
  expirationTime: z.number().finite().nonnegative().nullable().optional(),
  keys: z.object({ p256dh: key(65), auth: key(16) }).strict(),
}).strict();
export const pushDeviceTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const pushMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("register"), deviceToken: pushDeviceTokenSchema, subscription: pushSubscriptionSchema }).strict(),
  z.object({ action: z.literal("status"), deviceToken: pushDeviceTokenSchema, endpoint: z.string().max(4096) }).strict(),
  z.object({ action: z.literal("revoke"), deviceToken: pushDeviceTokenSchema }).strict(),
]);
export type PushSubscriptionData = z.infer<typeof pushSubscriptionSchema>;
export type PushPublicConfig = { available: boolean; publicKey: string | null; reason: string | null };
