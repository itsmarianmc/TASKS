import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StartupLoader } from "@/components/startup-loader";
import { startupStatus } from "@/lib/startup-status";
import type { Graph } from "@/lib/types";

const graph: Graph = { syncedAt: "2026-10-08T12:00:00Z", tasks: [], projects: [], areas: [] };
const base = { local: "ready" as const, notion: "pending" as const, cachedGraph: false, savedData: false, config: "ready" as const, sources: [], view: "today", prepared: false };

describe("terminal startup status", () => {
  it("reports only a restored cache and waits for a real Notion response", () => {
    const uncached = startupStatus(base);
    expect(uncached.steps.map(step => step.text)).toEqual(["Local workspace restored", "Connecting to Notion", "Preparing Today"]);
    const cached = startupStatus({ ...base, graph, cachedGraph: true, savedData: true });
    expect(cached.steps).toContainEqual({ id: "cache", state: "done", text: "Cached Notion graph restored" });
    expect(cached.steps.some(step => step.text.startsWith("Notion data loaded"))).toBe(false);
  });
  it("reports counts, required sources and readiness after successful work", () => {
    const status = startupStatus({ ...base, graph, notion: "ready", prepared: true, sources: [{ name: "Contact", state: "ready" }] });
    expect(status.steps).toContainEqual({ id: "notion", state: "done", text: "Notion data loaded · 0 tasks · 0 projects · 0 areas" });
    expect(status.steps).toContainEqual({ id: "contact", state: "done", text: "Contact data loaded" });
    expect(status.steps.at(-1)?.text).toBe("Workspace ready");
    expect(status.steps.some(step => step.text.includes("GitHub"))).toBe(false);
  });
  it("completes a requested settings read with a success marker", () => {
    expect(startupStatus({ ...base, config: "pending", configRequired: true }).steps).toContainEqual({ id: "config", state: "active", text: "Loading workspace settings" });
    expect(startupStatus({ ...base, config: "ready", configRequired: true }).steps).toContainEqual({ id: "config", state: "done", text: "Workspace settings loaded" });
  });
  it.each(["error", "saved"] as const)("releases saved data after %s without claiming a successful load", notion => {
    const status = startupStatus({ ...base, notion, cachedGraph: true, savedData: true, prepared: true });
    expect(status.blocked).toBeNull();
    expect(status.steps).toContainEqual({ id: "notion", state: "warning", text: "Notion unavailable · showing saved data" });
    expect(status.steps.at(-1)?.text).toBe("Workspace ready in offline mode");
  });
  it("offers retry without reporting readiness when no graph can be used", () => {
    const status = startupStatus({ ...base, notion: "error", prepared: true });
    expect(status.blocked).toBe("notion");
    expect(status.steps.at(-1)).toEqual({ id: "notion", state: "error", text: "Notion unavailable · no saved data available" });
  });
  it("stops at an unavailable local workspace and never logs entity IDs", () => {
    const error = startupStatus({ ...base, local: "error", view: "project:private-page-id" });
    expect(error.blocked).toBe("local");
    expect(error.steps).toHaveLength(1);
    const preparing = startupStatus({ ...base, view: "project:private-page-id" });
    expect(preparing.steps.at(-1)?.text).toBe("Preparing workspace view");
  });
  it("renders terminal markers, an active cursor and a polite status region", () => {
    const html = renderToStaticMarkup(createElement(StartupLoader, { steps: startupStatus(base).steps }));
    expect(html).toContain("[-]");
    expect(html).toContain("[✓]");
    expect(html).toContain('class="boot-cursor" aria-hidden="true">_');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("loading tasks");
  });
  it("keeps the prepare presentation active while data is already ready underneath", () => {
    const status = startupStatus({ ...base, notion: "ready", graph, prepared: true });
    const html = renderToStaticMarkup(createElement(StartupLoader, { steps: status.steps, ready: true }, createElement("button", null, "Updated workspace")));
    expect(status.steps.find(step => step.id === "prepare")?.state).toBe("done");
    expect(html).toContain('class="boot-line active" data-step="prepare"');
    expect(html).toContain('class="boot-line done" data-step="notion"');
    expect(html).not.toContain('data-step="ready"');
    expect(html).toContain('class="startup-workspace" inert="" aria-hidden="true"');
    expect(html).toContain("Updated workspace");
  });
});
