import type { AiFallbackStatus } from "./ai-contracts";
export interface PublicConfig { catalogs?: import("./catalogs").Catalogs; preferredLanguages?: string[]; timezone: string; maxUploadBytes: number; appName: "TÆSKS"; aiFallback?: AiFallbackStatus }
export const DEFAULT_TIMEZONE = "Europe/Berlin";
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const emptyGraph = { areas: [], projects: [], tasks: [], syncedAt: null };
