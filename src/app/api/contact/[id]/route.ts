import { z } from "zod";
import { contactId } from "@/lib/contact-contracts";
import { contactAdapter } from "@/lib/server/contact";
import { errorResponse, jsonResponse, validatedJson } from "@/lib/server/http";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { try { const id = contactId.parse((await context.params).id); const body = await validatedJson(request, z.object({ is_read: z.boolean() }).strict()); return jsonResponse({ item: await contactAdapter().mutate(id, body.is_read) }); } catch (error) { return errorResponse(error, "contact.mark"); } }
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) { try { const id = contactId.parse((await context.params).id); await validatedJson(request, z.object({ confirmed: z.literal(true) }).strict()); await contactAdapter().mutate(id); return jsonResponse({ deleted: true, id }); } catch (error) { return errorResponse(error, "contact.delete"); } }
