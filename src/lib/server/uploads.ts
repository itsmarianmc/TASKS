import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, open, unlink, rename } from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "./config";
import { MAX_UPLOAD_BYTES } from "@/lib/public-config";
import { repository } from "./repository";
import { AppError } from "./http";
import type { Attachment, EntityRef } from "@/lib/types";

export function sanitizeFilename(value: string): string {
  const basename = value.replace(/\\/g, "/").split("/").at(-1) || "attachment";
  return basename.normalize("NFC").replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_").replace(/^\.+|[. ]+$/g, "").slice(0, 180) || "attachment";
}
export function validateUploadMime(buffer: Buffer, declared: string): string {
  const mime = declared.split(";")[0].toLowerCase().trim() || "application/octet-stream";
  const starts = (bytes: number[]) => buffer.subarray(0, bytes.length).equals(Buffer.from(bytes));
  if (mime === "image/png" && starts([137, 80, 78, 71, 13, 10, 26, 10])) return mime;
  if (mime === "image/jpeg" && starts([255, 216, 255])) return mime;
  if (mime === "image/gif" && /^(GIF87a|GIF89a)$/.test(buffer.subarray(0, 6).toString("ascii"))) return mime;
  if (mime === "image/webp" && buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP") return mime;
  if (mime === "application/pdf" && buffer.subarray(0, 5).toString() === "%PDF-") return mime;
  if (["application/zip", "application/x-zip-compressed", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation"].includes(mime) && (starts([80, 75, 3, 4]) || starts([80, 75, 5, 6]))) return mime;
  if (["text/plain", "text/markdown", "text/csv", "application/json"].includes(mime) && !buffer.includes(0) && !buffer.toString("utf8").includes("\ufffd")) return mime;
  // Unknown binary files are downloadable only and never interpreted by the app.
  if (mime === "application/octet-stream") return mime;
  throw new AppError("UNSUPPORTED_FILE", "This file type is unsupported or its content does not match its type.", 415);
}
function uploadPath(storageName: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storageName)) throw new AppError("INVALID_STORAGE_PATH", "This attachment cannot be opened.", 400);
  return path.join(dataDirectory(), "uploads", storageName);
}
export async function saveAttachment(file: File, entity: EntityRef): Promise<Attachment> {
  if (!file.size) throw new AppError("EMPTY_FILE", "Choose a file with content.");
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError("FILE_TOO_LARGE", "Files must be 20 MB or smaller.", 413);
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = validateUploadMime(buffer, file.type);
  const id = randomUUID();
  const value = { id, entityType: entity.type, entityId: entity.id, name: sanitizeFilename(file.name), mimeType, size: file.size, storageName: randomUUID(), createdAt: new Date().toISOString() };
  const filepath = uploadPath(value.storageName);
  await mkdir(path.dirname(filepath), { recursive: true });
  // Only clean up a file this request has actually created. A disk/write/close
  // failure may leave partial bytes; metadata must never advertise those bytes.
  const handle = await open(filepath, "wx", 0o600);
  try {
    await handle.writeFile(buffer);
    await handle.close();
    await repository().addAttachment(value);
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(filepath).catch(() => {});
    throw error;
  }
  const { storageName: _private, ...publicValue } = value;
  return publicValue;
}
export async function downloadAttachment(id: string) {
  const attachment = await repository().getAttachment(id);
  if (!attachment) throw new AppError("NOT_FOUND", "This attachment no longer exists.", 404);
  let data: Buffer;
  try { data = await readFile(uploadPath(attachment.storageName)); }
  catch { throw new AppError("FILE_UNAVAILABLE", "The attachment file is unavailable. Check the persistent data volume.", 404); }
  return new Response(new Uint8Array(data), { headers: {
    "Content-Type": attachment.mimeType,
    "Content-Length": String(data.length),
    "Content-Disposition": `attachment; filename="${attachment.name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(attachment.name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16)}`)}`,
    "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; sandbox",
  } });
}
export async function deleteAttachment(id: string) {
  const repo = repository();
  const attachment = await repo.getAttachment(id);
  if (!attachment) throw new AppError("NOT_FOUND", "This attachment no longer exists.", 404);
  const filepath = uploadPath(attachment.storageName);
  const quarantine = path.join(path.dirname(filepath), `${attachment.storageName}.deleting-${randomUUID()}`);
  let moved = false;
  try { await rename(filepath, quarantine); moved = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  try { await repo.removeAttachment(id); }
  catch (error) { if (moved) await rename(quarantine, filepath); throw error; }
  if (moved) await unlink(quarantine).catch(() => console.warn(JSON.stringify({ level: "warn", source: "uploads", operation: "cleanup", attachmentId: id })));
}
