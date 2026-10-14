import { taskReconcileSchema } from "@/lib/notion-contracts";
import { taskService } from "@/lib/server/task-service";
import { errorResponse, jsonResponse, validatedJson } from "@/lib/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { return jsonResponse(await (await taskService()).reconcile(await validatedJson(request, taskReconcileSchema))); }
  catch (error) { return errorResponse(error, "notion.task.reconcile"); }
}
