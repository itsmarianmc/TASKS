import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) { super(message); this.name = "AppError"; }
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") throw new AppError("ORIGIN_REJECTED", "This action must be made from TÆSKS.", 403);
  const requestUrl = new URL(request.url);
  // Next's server URL can use the bind address rather than the browser's host.
  // Host is the actual HTTP destination; forwarded host is never trusted here.
  const allowed = process.env.APP_ORIGIN
    ? new URL(process.env.APP_ORIGIN).origin
    : new URL(`${requestUrl.protocol}//${request.headers.get("host") || requestUrl.host}`).origin;
  if (!origin || origin !== allowed) throw new AppError("ORIGIN_REJECTED", "This action must be made from TÆSKS.", 403);
}
export async function readLimitedBody(request: Request, maximumBytes: number) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maximumBytes) throw new AppError("BODY_TOO_LARGE", "The request exceeds the size limit.", 413);
  if (!request.body) throw new AppError("EMPTY_BODY", "A request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) { await reader.cancel(); throw new AppError("BODY_TOO_LARGE", "The request exceeds the size limit.", 413); }
    chunks.push(value);
  }
  return Buffer.concat(chunks, length);
}
export async function validatedJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  assertSameOrigin(request);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new AppError("CONTENT_TYPE", "Send this action as JSON.", 415);
  const body = await readLimitedBody(request, 1024 * 1024);
  let parsed: unknown;
  try { parsed = JSON.parse(body.toString("utf8")); } catch { throw new AppError("INVALID_JSON", "The request contains invalid JSON."); }
  return schema.parse(parsed);
}
export function jsonResponse(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
export function errorResponse(error: unknown, operation: string) {
  const correlationId = randomUUID();
  if (error instanceof z.ZodError) return jsonResponse({ error: { code: "VALIDATION_ERROR", message: "Check the submitted fields.", details: error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })), correlationId } }, 400);
  if (error instanceof AppError) return jsonResponse({ error: { code: error.code, message: error.message, details: error.details, correlationId } }, error.status);
  // Deliberately omit raw errors, request bodies, headers and credentials.
  console.error(JSON.stringify({ level: "error", source: "taesks", operation, status: 500, correlationId, errorType: error instanceof Error ? error.name : "UnknownError" }));
  return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "This action could not be completed. Please retry.", correlationId } }, 500);
}
