import type { ParseResult } from "./types";

export interface AiFallbackStatus {
  provider: "Gemini";
  model: string;
  enabled: boolean;
  status: "ready" | "not configured" | "disabled";
  confidenceThreshold: number;
}
export interface AiParseResponse {
  result: ParseResult;
  fallback: "not needed" | "unavailable" | "accepted" | "failed";
}
