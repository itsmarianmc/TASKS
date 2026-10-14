import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import type { LocalSnapshot } from "@/lib/types";

it("retains SSR task data while the splash covers client preparation", () => {
  const client = new QueryClient();
  const html = renderToString(createElement(QueryClientProvider, { client }, createElement<NonNullable<Parameters<typeof AppShell>[0]>>(AppShell, {
    initialView: "overview",
    initialLocal: { metadata: [], notes: [], attachments: [], links: [], tags: [], taskTags: [], aliases: [], filters: [], integrations: [], externalLinks: [], drafts: [], preferences: { theme: "dark", sidebarCollapsed: false, lastView: "overview", notificationPermissionAsked: false }, notionMapping: {} } satisfies LocalSnapshot,
    initialGraph: { graph: { areas: [], projects: [], tasks: [{ id: "stale", title: "Stale completed elsewhere", projectId: null, areaId: null, dates: { start: null, end: null }, completed: false, highlight: false, url: "https://notion.so/stale", createdAt: "2026-10-03T12:00:00Z", updatedAt: "2026-10-03T12:00:00Z" }], syncedAt: "2026-10-03T12:00:00Z" }, diagnostics: [], completionEnabled: true },
  })));
  expect(html).toContain('class="boot-screen"');
  expect(html).toContain("Local workspace restored");
  expect(html).toContain("Cached Notion graph restored");
  expect(html).toContain("Connecting to Notion");
  expect(html).not.toContain("Notion data loaded");
  expect(html).not.toContain("Stale completed elsewhere");
  expect(client.getQueryData<{ graph: { tasks: { title: string }[] } }>(["graph"])?.graph.tasks[0].title).toBe("Stale completed elsewhere");
  client.clear();
});
