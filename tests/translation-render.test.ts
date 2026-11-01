import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LocalizationProvider } from "@/components/localization";
import { TaskFields } from "@/components/task-fields";
import english from "../public/locales/en/language.json";
import { viewTitle } from "@/lib/views";
import type { Graph, LocalSnapshot } from "@/lib/types";

it("renders catalog text on the server, preserves user content and leaves option values stable", () => {
  const keyFor = (source: string) => Object.entries(english.strings).find(([, value]) => value === source)![0];
  const strings = Object.fromEntries([["Task title", "Aufgabentitel"], ["none", "keine"], ["Today", "Heute"]].map(([source, translated]) => [keyFor(source), translated]));
  const graph: Graph = { tasks: [], syncedAt: null, projects: [{ id: "p", name: "Today", areaIds: ["a"], dates: { start: null, end: null }, status: null, priority: null, url: "" }], areas: [{ id: "a", name: "Undo", projectIds: ["p"], type: null, url: "" }] };
  const local = { preferences: { language: "de" } } as LocalSnapshot;
  const client = new QueryClient();
  const localizationProps = {
    initialLocal: local,
    initialConfig: { appName: "TÆSKS" as const, timezone: "Europe/Berlin", maxUploadBytes: 1, preferredLanguages: ["de-DE"], catalogs: { languages: [{ schemaVersion: 1 as const, lang: "de", name: "German", locName: "Deutsch", strings: { ...strings, "common.undo": "Rückgängig" } }], dates: [], diagnostics: [] } },
    children: createElement(TaskFields, { graph, value: { title: "Undo", projectId: "p", areaId: "a", dates: { start: null, end: null }, highlight: false, tags: [], priority: "none", recurrenceRule: null }, onChange: () => {} }),
  };
  const html = renderToString(createElement(QueryClientProvider, { client }, createElement(LocalizationProvider, localizationProps)));
  expect(html).toContain('aria-label="Aufgabentitel"');
  expect(html).toContain('value="Undo"');
  expect(html).toContain('$ Today');
  expect(html).toContain('@ Undo');
  expect(html).toContain('value="none" selected="">keine');
  expect(viewTitle("project:p", graph, local, value => value === "Today" ? "Heute" : value)).toBe("Today");
  expect(viewTitle("today", graph, local, value => value === "Today" ? "Heute" : value)).toBe("Heute");
  client.clear();
});
