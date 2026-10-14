import { contactParameters } from "@/lib/contact-contracts";
import { contactAdapter } from "@/lib/server/contact";
import { errorResponse, jsonResponse } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { try { const { refresh, ...options } = contactParameters.parse(Object.fromEntries(new URL(request.url).searchParams)); return jsonResponse(await contactAdapter().list(options, refresh === "1")); } catch (error) { return errorResponse(error, "contact.read"); } }
