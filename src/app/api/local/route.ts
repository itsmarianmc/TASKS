import { repository } from "@/lib/server/repository";
import { errorResponse, jsonResponse, validatedJson } from "@/lib/server/http";
import { localMutationSchema } from "@/lib/schemas";
import { githubAdapter } from "@/lib/server/github";
import { taskService } from "@/lib/server/task-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return jsonResponse(await repository().snapshot()); } catch (error) { return errorResponse(error, "local.read"); }
}
export async function POST(request: Request) {
  try {
    const mutation = await validatedJson(request, localMutationSchema);
    if (mutation.action === "saveIntegration") mutation.repository = await githubAdapter().validateRepository(mutation.repository);
    const repo = repository();
    if (mutation.action === "linkExternal") {
      const response = await (await taskService()).reconcile({ taskId: mutation.taskId, source: { source: mutation.source, externalId: mutation.externalId, url: mutation.url }, inspected: true });
      return jsonResponse({ result: response.task, snapshot: response.snapshot });
    }
    const result = await repo.mutate(mutation);
    return jsonResponse({ result, snapshot: await repo.snapshot() });
  } catch (error) { return errorResponse(error, "local.mutate"); }
}
