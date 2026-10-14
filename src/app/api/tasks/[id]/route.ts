import { z } from "zod";
import { taskPatchSchema } from "@/lib/notion-contracts";
import { taskService } from "@/lib/server/task-service";
import { errorResponse, jsonResponse, validatedJson } from "@/lib/server/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  try {
    const body = await validatedJson(request, taskPatchSchema);
    return jsonResponse(await (await taskService()).update((await context.params).id, body));
  }
  catch (error) { return errorResponse(error, "notion.task.update"); }
}
export async function DELETE(request: Request, context: Context) {
  try { await validatedJson(request, z.object({ confirmed: z.literal(true) }).strict()); return jsonResponse(await (await taskService()).delete((await context.params).id)); }
  catch (error) { return errorResponse(error, "notion.task.delete"); }
}
