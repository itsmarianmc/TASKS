import type { Graph } from "./types";
import { mainViews } from "./views";

export type StartupRead = "pending" | "ready" | "error" | "saved" | "disabled";
export interface StartupStep { id: string; state: "pending" | "active" | "done" | "warning" | "error"; text: string }

export function startupStatus({ local, notion, cachedGraph, savedData, graph, config, configRequired = false, sources, view, prepared }: {
  local: "pending" | "ready" | "error";
  notion: StartupRead;
  cachedGraph: boolean;
  savedData: boolean;
  graph?: Graph;
  config: "pending" | "ready" | "error";
  configRequired?: boolean;
  sources: { name: "GitHub" | "Contact"; state: StartupRead }[];
  view: string;
  prepared: boolean;
}) {
  const steps: StartupStep[] = [{ id: "local", state: local === "ready" ? "done" : local === "error" ? "error" : "active", text: local === "ready" ? "Local workspace restored" : local === "error" ? "Local workspace unavailable · retry to restore saved data" : "Restoring local workspace" }];
  if (local === "error") return { steps, blocked: "local" as const, offline: false };
  if (cachedGraph) steps.push({ id: "cache", state: "done", text: "Cached Notion graph restored" });
  const unavailable = notion === "error" || notion === "saved";
  const offline = unavailable;
  steps.push({ id: "notion", state: unavailable ? "warning" : notion === "disabled" ? "warning" : notion === "ready" ? "done" : "active", text:
    unavailable ? `Notion unavailable · ${savedData ? "showing saved data" : "no saved data available"}` :
    notion === "disabled" ? "Notion not configured · open Settings & diagnostics" :
    notion === "ready" && graph ? `Notion data loaded · ${graph.tasks.length} tasks · ${graph.projects.length} projects · ${graph.areas.length} areas` : "Connecting to Notion" });
  if (configRequired || config !== "ready") steps.push({ id: "config", state: config === "ready" ? "done" : config === "error" ? "warning" : "active", text: config === "ready" ? "Workspace settings loaded" : config === "error" ? "Workspace settings unavailable · using defaults" : "Loading workspace settings" });
  for (const source of sources) steps.push({ id: source.name.toLowerCase(), state: source.state === "pending" ? "active" : source.state === "ready" ? "done" : "warning", text:
    source.state === "pending" ? `Connecting to ${source.name}` : source.state === "ready" ? `${source.name} data loaded` : source.state === "disabled" ? `${source.name} not configured` : `${source.name} unavailable · continuing with available data` });
  // Entity names and IDs never enter the startup log.
  const viewName = mainViews.find(item => item.id === view)?.label ?? (view === "settings" ? "Settings & diagnostics" : view === "github" ? "GitHub" : view === "contact" ? "Contact" : "workspace view");
  if (local === "ready") steps.push({ id: "prepare", state: prepared ? "done" : "active", text: `Preparing ${viewName}` });
  if (prepared) steps.push({ id: "ready", state: "done", text: offline ? "Workspace ready in offline mode" : "Workspace ready" });
  let waiting = false;
  for (const step of steps) {
    if (waiting) step.state = "pending";
    else if (step.state === "active") waiting = true;
  }
  return { steps, blocked: null, offline };
}
