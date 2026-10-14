import "server-only";
import type { AiFallbackStatus } from "@/lib/ai-contracts";

function boundedNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = value?.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
export function geminiConfig() {
  return {
    apiKey: process.env.GEMINI_API_KEY?.trim() || "",
    model: process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite",
    enabled: process.env.GEMINI_FALLBACK_ENABLED?.trim().toLowerCase() !== "false",
    timeoutMs: Math.round(boundedNumber(process.env.GEMINI_TIMEOUT_MS, 5000, 100, 30000)),
    confidenceThreshold: boundedNumber(process.env.GEMINI_CONFIDENCE_THRESHOLD, 0.75, 0, 1),
  };
}
export type GeminiConfig = ReturnType<typeof geminiConfig>;
export function geminiStatus(): AiFallbackStatus {
  const config = geminiConfig();
  return { provider: "Gemini", model: config.model, enabled: config.enabled && !!config.apiKey,
    status: !config.enabled ? "disabled" : config.apiKey ? "ready" : "not configured",
    confidenceThreshold: config.confidenceThreshold };
}
