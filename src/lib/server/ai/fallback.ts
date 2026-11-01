import "server-only";
import { calendarToday } from "@/lib/calendar";
import { parseQuickAdd, quotedSpans } from "@/lib/parser";
import type { Graph, ParseContext, ParserAlias, Tag } from "@/lib/types";
import type { AiParseResponse } from "@/lib/ai-contracts";
import { geminiConfig } from "./config";
import { parseWithGemini } from "./gemini";

export async function parseTaskCapture(input: string, graph: Graph, aliases: ParserAlias[], context: ParseContext, tags: Tag[], signal?: AbortSignal,
  parseAi = parseWithGemini, config = geminiConfig()): Promise<AiParseResponse> {
  const timezone = context.timezone ?? "Europe/Berlin";
  const resolvedContext = { ...context, timezone, today: context.today ?? calendarToday(timezone) };
  const result = parseQuickAdd(input, graph, aliases, resolvedContext, tags);
  if (result.valid && result.confidence >= config.confidenceThreshold) return { result, fallback: "not needed" };
  if (context.literalQuotedText !== false && quotedSpans(input).length) return { result, fallback: "unavailable" };
  if (!input.trim() || input.length > 10000 || !config.enabled || !config.apiKey || signal?.aborted || !graph.projects.length || !graph.areas.length) return { result, fallback: "unavailable" };
  try {
    return { result: await parseAi({ input, graph, aliases, context: resolvedContext, tags, deterministic: result }, config, signal), fallback: "accepted" };
  } catch { return { result, fallback: "failed" }; }
}
