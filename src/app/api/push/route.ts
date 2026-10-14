import { pushMutationSchema } from "@/lib/push-contracts";
import { getDatabase } from "@/lib/server/db";
import { AppError, errorResponse, jsonResponse, validatedJson } from "@/lib/server/http";
import { pushConfig } from "@/lib/server/push-config";
import { createPushStore } from "@/lib/server/push-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Only this dedicated, non-cached endpoint exposes the public VAPID key.
export function GET() { return jsonResponse(pushConfig().public); }
export async function POST(request: Request) {
  try {
    const mutation = await validatedJson(request, pushMutationSchema);
    if (mutation.action === "register" && (process.env.NODE_ENV !== "production" || !pushConfig().public.available)) throw new AppError("PUSH_UNAVAILABLE", "Push is unavailable. Check the server configuration and production mode.", 503);
    const store = createPushStore(getDatabase());
    if (mutation.action === "revoke") { store.revoke(mutation.deviceToken); return jsonResponse({ registered: false }); }
    if (mutation.action === "status") return jsonResponse({ registered: store.status(mutation.deviceToken, mutation.endpoint) });
    store.register(mutation.deviceToken, mutation.subscription);
    return jsonResponse({ registered: true });
  } catch (error) { return errorResponse(error, "push.mutate"); }
}
