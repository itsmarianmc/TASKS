import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { contactItemSchema, contactParameters, type ContactItem, type ContactOptions, type ContactResponse } from "../contact-contracts";
import { AppError } from "./http";

export interface ContactTransport { request(url: string, init: RequestInit): Promise<{ status: number; data: unknown; headers: Headers }> }
const fields = "id,site_origin,name,email,message,created_at,is_read";
const limit = 50;
const transport: ContactTransport = { request: async (url, init) => {
  const response = await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return { status: response.status, data: null, headers: response.headers };
  if (!response.body) return { status: response.status, data: null, headers: response.headers };
  const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new AppError("CONTACT_DATA", "Contact returned an oversized response.", 502); } chunks.push(value); }
  let data: unknown; try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new AppError("CONTACT_DATA", "Contact returned an invalid response.", 502); }
  return { status: response.status, data, headers: response.headers };
} };
export function contactHeaders(auth?: string): Headers {
  const headers = new Headers({ Accept: "application/json" });
  if (auth) { const match = /^([A-Za-z0-9-]+):[ \t]*(\S[^\r\n]*)$/.exec(auth); if (!match || /^(host|connection|content-length|content-type|accept|prefer|range|cookie|set-cookie|origin|referer|proxy-.*|sec-.*)$/i.test(match[1])) throw new AppError("CONTACT_CONFIG", "Check the Contact authentication header format on the server.", 503); headers.set(match[1], match[2]); }
  return headers;
}
function total(headers: Headers): number { const match = /^(?:\d+-\d+|\*)\/(\d+)$/.exec(headers.get("content-range") ?? ""); const value = match ? Number(match[1]) : NaN; if (!Number.isSafeInteger(value) || value < 0) throw new AppError("CONTACT_COUNT", "Contact did not return an exact count. Check PostgREST count permissions.", 502); return value; }
function upstreamError(status: number): AppError { return new AppError("CONTACT_UPSTREAM", status === 401 ? "Contact rejected authentication. Check the server credentials." : [403, 404].includes(status) ? "Contact denied this operation. Check table permissions and row policies." : status === 429 ? "Contact rate limit reached. Wait before retrying." : "Contact could not be reached. Check connectivity and retry.", [401, 403, 404].includes(status) ? 502 : 503); }
function literal(value: string) { return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`; }
export class ContactAdapter {
  private cache = new Map<string, { expires: number; data: ContactResponse }>();
  private inflight = new Map<string, Promise<ContactResponse>>();
  private counts?: { expires: number; value: number }; private countPromise?: Promise<number>;
  private generation = 0;
  constructor(private config: { baseUrl: string; auth?: string }, private io: ContactTransport = transport, private now = () => Date.now()) {}
  private url(parameters: Record<string, string>) {
    let base: URL; try { base = new URL(this.config.baseUrl); } catch { throw new AppError("CONTACT_CONFIG", "Check CONTACT_API_BASE_URL on the server.", 503); }
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new AppError("CONTACT_CONFIG", "Contact base URL must be HTTP(S), without credentials or query parameters.", 503);
    base.pathname = `${base.pathname.replace(/\/$/, "")}/contact_submissions`; Object.entries(parameters).forEach(([key, value]) => base.searchParams.set(key, value)); return base.href;
  }
  private async request(parameters: Record<string, string>, method = "GET", body?: unknown) {
    const headers = contactHeaders(this.config.auth); headers.set("Prefer", method === "GET" ? "count=exact" : "return=representation"); if (body) headers.set("Content-Type", "application/json");
    let response; try { response = await this.io.request(this.url(parameters), { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }); } catch (error) { if (error instanceof AppError) throw error; throw new AppError("CONTACT_NETWORK", method === "GET" ? "Contact could not be read. Check connectivity and retry." : "Contact did not confirm this change. Refresh and inspect the message before retrying.", 503); }
    if (response.status < 200 || response.status >= 300) throw upstreamError(response.status); return response;
  }
  private async unread(force: boolean) {
    if (!force && this.counts && this.counts.expires > this.now()) return this.counts.value;
    if (!this.countPromise) { const generation = this.generation; const promise = (async () => { const response = await this.request({ select: "id", is_read: "eq.false", limit: "0" }); if (!Array.isArray(response.data) || response.data.length !== 0) throw new AppError("CONTACT_DATA", "Contact returned invalid count data.", 502); const value = total(response.headers); if (generation === this.generation) this.counts = { expires: this.now() + 60_000, value }; return value; })().finally(() => { if (this.countPromise === promise) this.countPromise = undefined; }); this.countPromise = promise; }
    return this.countPromise;
  }
  async list(options: ContactOptions, force = false): Promise<ContactResponse> {
    const input = contactParameters.parse(options); const key = JSON.stringify(input); const previous = this.cache.get(key);
    if (!force && previous && previous.expires > this.now()) return previous.data;
    if (!force && previous) { void this.list(input, true).catch(() => undefined); return previous.data; }
    if (this.inflight.has(key)) return this.inflight.get(key)!;
    const generation = this.generation;
    const promise = (async () => {
      let value: ContactResponse;
      try {
        const params: Record<string, string> = { select: fields, order: `created_at.${input.sort === "newest" ? "desc" : "asc"},id.${input.sort === "newest" ? "desc" : "asc"}`, limit: String(limit), offset: String((input.page - 1) * limit) };
        if (input.filter !== "all") params.is_read = `eq.${input.filter === "read"}`;
        if (input.site) params.site_origin = `eq.${literal(input.site)}`;
        // PostgREST quoted literals prevent grammar injection; SQL wildcard characters are escaped.
        if (input.search) { const pattern = literal(`%${input.search.replace(/[\\%_]/g, "\\$&")}%`); params.or = `(name.ilike.${pattern},email.ilike.${pattern},message.ilike.${pattern},site_origin.ilike.${pattern})`; }
        const [list, unread] = await Promise.allSettled([this.request(params), this.unread(force)]);
        if (list.status === "rejected") throw list.reason;
        const items = z.array(contactItemSchema).max(limit).parse(list.value.data); if (new Set(items.map(item => item.id)).size !== items.length) throw new AppError("CONTACT_DATA", "Contact returned duplicate message identities.", 502);
        const count = total(list.value.headers); const syncedAt = new Date(this.now()).toISOString();
        value = { items, total: count, unreadTotal: unread.status === "fulfilled" ? unread.value : previous?.data.unreadTotal ?? null, page: input.page, hasMore: input.page * limit < count, status: unread.status === "fulfilled" ? "ok" : "error", message: unread.status === "fulfilled" ? "" : "Unread count unavailable. Last count retained; refresh to retry.", syncedAt, diagnostics: [] };
        if (unread.status === "rejected") value.correlationId = randomUUID();
      } catch (error) {
        const correlationId = randomUUID(); console.error(JSON.stringify({ source: "contact", operation: "read", correlationId }));
        value = { ...(previous?.data ?? { items: [], total: null, unreadTotal: null, page: input.page, hasMore: false, syncedAt: null, diagnostics: [] }), status: "error", message: `${error instanceof AppError ? error.message : "Contact returned invalid message data. Check the table schema."}${previous?.data.syncedAt ? " Last read messages retained." : ""}`, correlationId };
      }
      value.diagnostics = [{ source: "contact", status: value.status, message: value.status === "ok" ? "Connected · unread count verified" : value.message, checkedAt: new Date(this.now()).toISOString(), details: value.correlationId ? [value.correlationId] : [] }];
      if (generation === this.generation) { this.cache.set(key, { expires: this.now() + 60_000, data: value }); if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value!); }
      return value;
    })().finally(() => { if (this.inflight.get(key) === promise) this.inflight.delete(key); }); this.inflight.set(key, promise); return promise;
  }
  async mutate(id: number, read?: boolean): Promise<ContactItem> {
    // Public callers validate IDs too; preserve adapter safety for all future callers.
    const identity = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(id);
    const response = await this.request({ id: `eq.${identity}`, select: fields }, read === undefined ? "DELETE" : "PATCH", read === undefined ? undefined : { is_read: read }).finally(() => {
      // Even an unconfirmed write might have reached PostgREST. Inspection must not reuse an older read.
      this.generation++; this.counts = undefined; this.countPromise = undefined; this.inflight.clear();
      for (const entry of this.cache.values()) entry.expires = 0;
    });
    const parsed = z.array(contactItemSchema).safeParse(response.data);
    if (!parsed.success || parsed.data.length !== 1 || parsed.data[0].id !== identity || read !== undefined && parsed.data[0].is_read !== read) throw new AppError("CONTACT_UNCONFIRMED", "Contact did not confirm an affected message. Refresh and inspect it; check write permissions and row policies.", 502);
    for (const [key, entry] of this.cache) {
      const options = JSON.parse(key) as ContactOptions; const matches = read !== undefined && (options.filter === "all" || (options.filter === "read") === read);
      entry.expires = 0; entry.data = { ...entry.data, items: entry.data.items.flatMap(item => item.id !== identity ? [item] : matches ? [parsed.data[0]] : []), total: null, unreadTotal: null, status: "error", message: "Message updated. Refresh to verify counts.", hasMore: false };
    }
    return parsed.data[0];
  }
}
let singleton: { fingerprint: string; adapter: ContactAdapter } | undefined;
export function contactAdapter() { const baseUrl = process.env.CONTACT_API_BASE_URL?.trim() || "http://192.168.2.173:1917", auth = process.env.CONTACT_API_AUTH_HEADER?.trim(); const fingerprint = `${baseUrl}:${auth ?? ""}`; if (!singleton || singleton.fingerprint !== fingerprint) singleton = { fingerprint, adapter: new ContactAdapter({ baseUrl, auth }) }; return singleton.adapter; }
