import { z } from "zod";
import { entityRefSchema } from "@/lib/schemas";
import { MAX_UPLOAD_BYTES } from "@/lib/public-config";
import { assertSameOrigin, readLimitedBody, AppError, errorResponse, jsonResponse } from "@/lib/server/http";
import { saveAttachment } from "@/lib/server/uploads";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data;")) throw new AppError("CONTENT_TYPE", "Send a multipart file upload.", 415);
    const buffer = await readLimitedBody(request, MAX_UPLOAD_BYTES + 64 * 1024);
    const form = await new Response(new Uint8Array(buffer), { headers: { "Content-Type": contentType } }).formData();
    const entity = entityRefSchema.parse({ type: form.get("entityType"), id: form.get("entityId") });
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("FILE_REQUIRED", "Choose a file to upload.");
    if (form.getAll("file").length !== 1 || [...form.keys()].some(key => !["file", "entityType", "entityId"].includes(key))) throw new z.ZodError([{ code: "custom", path: [], message: "Send one file and its entity reference." }]);
    return jsonResponse(await saveAttachment(file, entity), 201);
  } catch (error) { return errorResponse(error, "attachments.upload"); }
}
