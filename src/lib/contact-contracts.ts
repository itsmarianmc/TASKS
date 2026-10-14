import { z } from "zod";
import type { Diagnostic } from "./types";

export const contactId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const contactItemSchema = z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), site_origin: z.string().max(4096), name: z.string().max(10000), email: z.string().max(10000), message: z.string().max(1_000_000), created_at: z.string().datetime({ offset: true }), is_read: z.boolean() });
export type ContactItem = z.infer<typeof contactItemSchema>;
export const contactParameters = z.object({ filter: z.enum(["all", "read", "unread"]).default("all"), sort: z.enum(["newest", "oldest"]).default("newest"), page: z.coerce.number().int().min(1).max(10000).default(1), site: z.string().trim().max(512).default(""), search: z.string().trim().max(200).default(""), refresh: z.enum(["0", "1"]).optional() }).strict();
export type ContactOptions = Omit<z.infer<typeof contactParameters>, "refresh">;
export const defaultContactOptions: ContactOptions = { filter: "all", sort: "newest", page: 1, site: "", search: "" };
export interface ContactResponse { items: ContactItem[]; total: number | null; unreadTotal: number | null; page: number; hasMore: boolean; status: "ok" | "error"; message: string; syncedAt: string | null; correlationId?: string; diagnostics: Diagnostic[]; countsPending?: boolean }
export function safeContactSite(value: string): string | null { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } }
export function contactMailto(value: string): string | null { return z.email().safeParse(value).success && !/[\r\n]/.test(value) ? `mailto:${encodeURIComponent(value)}` : null; }
/** Preserve the first message line verbatim. The composer supports a maximum 2,000-character title. */
export function contactTaskTitle(item: ContactItem) { return (item.message.split(/\r?\n/).find(line => line.trim()) || item.name || `Contact submission #${item.id}`).slice(0, 2000); }
