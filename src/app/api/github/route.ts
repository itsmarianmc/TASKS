import { z } from "zod";
import { githubSections, repositoryNameSchema } from "@/lib/github-contracts";
import { githubAdapter } from "@/lib/server/github";
import { AppError, errorResponse, jsonResponse } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const parameters = z.object({ repository: repositoryNameSchema.optional(), section: z.enum(githubSections).optional(), page: z.coerce.number().int().min(1).max(100).default(1), refresh: z.enum(["0", "1"]).optional() }).strict().refine(value => !!value.repository === !!value.section, "Provide both repository and section.");
export async function GET(request: Request) {
  try { const input = parameters.parse(Object.fromEntries(new URL(request.url).searchParams)); const adapter = githubAdapter();
    if (input.repository && input.section) return jsonResponse(await adapter.section(input.repository, input.section, input.page, input.refresh === "1"));
    if (input.page > 20) throw new AppError("SEARCH_LIMIT", "GitHub search supports at most 1,000 results.");
    return jsonResponse(await adapter.dashboard(input.refresh === "1", input.page));
  } catch (error) { return errorResponse(error, "github.read"); }
}
