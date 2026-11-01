import { expect, it, vi } from "vitest";
import vm from "node:vm";
const state = vi.hoisted(() => ({ language: "de" }));
vi.mock("@/lib/server/repository", () => ({ repository: () => ({ getPreferences: async () => ({ language: state.language }) }) }));
vi.mock("@/lib/server/catalogs", () => ({ configuredCatalogs: async () => ({ languages: [{ schemaVersion: 1, lang: "de", name: "German", locName: "Deutsch", strings: { "reminders.title": "TÆSKS / Erinnerung", "reminders.body": "Eine Erinnerung ist fällig. TÆSKS öffnen." } }], dates: [], diagnostics: [] }) }));
import { GET } from "@/app/sw.js/route";

it("uses validated generic catalog copy in the served worker while ignoring private payload fields", async () => {
  const response = await GET(new Request("http://localhost/sw.js"));
  const listeners = new Map<string, (event: unknown) => void>();
  const showNotification = vi.fn();
  vm.runInNewContext(await response.text(), { self: { location: { origin: "http://localhost" }, registration: { showNotification }, addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback) }, URL });
  let pending: Promise<void> | undefined;
  listeners.get("push")!({ data: { json: () => ({ type: "reminder", taskId: "00000000-0000-4000-8000-000000000001", reminderAt: "2026-10-31T12:00:00Z", tag: `taesks-${"a".repeat(43)}`, title: "Private title" }) }, waitUntil: (work: Promise<void>) => { pending = work; } });
  await pending;
  expect(showNotification.mock.calls[0][0]).toBe("TÆSKS / Erinnerung");
  expect(showNotification.mock.calls[0][1].body).toBe("Eine Erinnerung ist fällig. TÆSKS öffnen.");
  expect(JSON.stringify(showNotification.mock.calls)).not.toContain("Private title");
  expect(response.headers.get("cache-control")).toContain("no-store");
});
