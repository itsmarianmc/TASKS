import { z } from "zod";
import { idSchema } from "@/lib/schemas";
import { downloadAttachment, deleteAttachment } from "@/lib/server/uploads";
import { validatedJson, errorResponse, jsonResponse } from "@/lib/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try { return await downloadAttachment(idSchema.parse((await context.params).id)); }
  catch (error) { return errorResponse(error, "attachments.download"); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    await validatedJson(request, z.object({ confirmed: z.literal(true) }).strict());
    await deleteAttachment(idSchema.parse((await context.params).id));
    return jsonResponse({ deleted: true });
  } catch (error) { return errorResponse(error, "attachments.delete"); }
}
