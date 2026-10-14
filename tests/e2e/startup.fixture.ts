import { expect, test, type Page } from "@playwright/test";
import type { Graph, LocalSnapshot } from "../../src/lib/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { startupStatus, type StartupRead } from "../../src/lib/startup-status";
import { projectContext } from "../../src/lib/view-context";

// Keep streamed props and their server-rendered loader consistent; no runtime test path.
export async function initialSnapshot(page: Page, graph: Graph | undefined, local: LocalSnapshot | undefined, initialView = "today") {
  if (page.context().browser()?.browserType().name() === "chromium") await page.context().grantPermissions(["local-network-access"]);
  await page.route(url => url.origin === new URL(test.info().project.use.baseURL as string).origin && url.pathname === "/", async route => {
    const response = await route.fetch();
    let replaced = false;
    const props = { initialGraph: graph ? { graph, diagnostics: [{ source: "notion" as const, status: "ok" as const, message: "Cached fixture" }], completionEnabled: true } : "$undefined", initialLocal: local ?? "$undefined", initialView, initialConfig: { timezone: "Europe/Berlin", maxUploadBytes: 20971520, appName: "TÆSKS" as const } };
    let body = (await response.text()).replace(/self\.__next_f\.push\((\[.*?\])\)<\/script>/g, (script, encoded: string) => {
      const frame = JSON.parse(encoded);
      if (typeof frame[1] !== "string") return script;
      for (const [name, value] of Object.entries(props)) {
        const marker = `"${name}":`;
        const start = frame[1].indexOf(marker);
        if (start < 0) continue;
        const valueStart = start + marker.length;
        for (let end = valueStart + 1; end <= frame[1].length; end++) {
          try { JSON.parse(frame[1].slice(valueStart, end)); } catch { continue; }
          frame[1] = frame[1].slice(0, valueStart) + JSON.stringify(value) + frame[1].slice(end);
          if (name === "initialGraph") replaced = true;
          break;
        }
      }
      return `self.__next_f.push(${JSON.stringify(frame)})</script>`;
    });
    expect(replaced).toBe(true);
    const sources: { name: "GitHub" | "Contact"; state: StartupRead }[] = [];
    const context = projectContext(initialView);
    if (["inbox", "github", "settings"].includes(initialView) || local?.integrations.some(item => item.projectId === context?.projectId)) sources.push({ name: "GitHub", state: "pending" });
    if (["inbox", "contact", "settings"].includes(initialView)) sources.push({ name: "Contact", state: "pending" });
    const status = startupStatus({ local: local ? "ready" : "pending", notion: "pending", cachedGraph: !!graph?.syncedAt, savedData: !!graph, graph, config: "ready", sources, view: initialView, prepared: false });
    // Playwright transforms JSX into its own component descriptors; use DOM elements here.
    const loader = createElement("div", { className: "boot-screen", "data-phase": "waiting" }, createElement("div", { className: "boot-content" },
      createElement("span", { className: "boot-brand" }, "T", createElement("span", { className: "brand-mark" }, createElement("span", null, "["), createElement("i", null, "Æ"), createElement("span", null, "]")), "SKS."),
      createElement("div", { className: "boot-status", role: "status", "aria-live": "polite", "aria-atomic": true }, status.steps.map(step =>
        createElement("p", { key: step.id, className: `boot-line ${step.state}`, "data-step": step.id },
          createElement("span", { className: "boot-marker", "aria-hidden": true }, step.state === "active" ? "[-]" : step.state === "done" ? "[✓]" : "[!]"),
          createElement("span", null, step.text, step.state === "active" ? createElement("span", { className: "boot-cursor", "aria-hidden": true }, "_") : null))))));
    body = body.replace(/<div class="boot-screen"[^>]*>[\s\S]*?<\/div><\/div><\/div>/, renderToStaticMarkup(loader));
    // Next's development launcher floats over the footer on mobile; it is not app UI.
    body = body.replace("</head>", "<style>nextjs-portal{display:none!important}</style></head>");
    await route.fulfill({ response, body });
  });
}

