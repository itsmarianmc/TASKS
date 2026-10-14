import { taskCreateSchema } from "@/lib/notion-contracts";
import { taskService } from "@/lib/server/task-service";
import { errorResponse, jsonResponse, validatedJson } from "@/lib/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await validatedJson(request, taskCreateSchema);
    return jsonResponse(await (await taskService()).create(body), 201);
  }
  catch (error) { return errorResponse(error, "notion.task.create"); }
}
