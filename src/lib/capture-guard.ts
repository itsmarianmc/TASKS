import { z } from "zod";
import { withBrowserLock } from "./browser-lock";

const outcomeSchema = z.object({ input: z.string(), state: z.enum(["pending", "uncertain", "confirmed"]), taskId: z.string().optional() });
function history() { return z.array(outcomeSchema).parse(JSON.parse(localStorage.getItem("taesks.capture-history") ?? "[]")).filter(value => value.state !== "confirmed"); }
export function captureRevision() { return localStorage.getItem("taesks.capture-outcome"); }
export function latestCaptureOutcome() { const raw = captureRevision(); return raw ? outcomeSchema.parse(JSON.parse(raw)) : null; }
export function captureOutcome(input: string) {
  const previous = history().find(value => value.input === input);
  if (previous) return previous;
  const raw = localStorage.getItem("taesks.capture-outcome");
  if (!raw) return null;
  const outcome = outcomeSchema.parse(JSON.parse(raw));
  return outcome.input === input && outcome.state !== "confirmed" ? outcome : null;
}
export function recordCapture(input: string, state: "pending" | "uncertain" | "confirmed", taskId?: string) {
  const previousHistory = localStorage.getItem("taesks.capture-history"); const previousMarker = captureRevision();
  const records = history().filter(value => value.input !== input);
  const outcome = { input, state, ...(taskId ? { taskId } : {}) };
  const retained = JSON.stringify(state === "confirmed" ? records : [...records, outcome]);
  const marker = JSON.stringify(outcome);
  try {
    localStorage.setItem("taesks.capture", input);
    localStorage.setItem("taesks.capture-history", retained);
    if (localStorage.getItem("taesks.capture-history") !== retained) throw new Error("Capture storage did not retain its replay history.");
    localStorage.setItem("taesks.capture-outcome", marker);
    if (captureRevision() !== marker) throw new Error("Capture storage did not retain its replay marker.");
  } catch (error) {
    // No request has been dispatched by the caller yet. Restore any partially
    // written marker so a recoverable storage failure does not invent uncertainty.
    try {
      if (previousHistory === null) localStorage.removeItem("taesks.capture-history"); else localStorage.setItem("taesks.capture-history", previousHistory);
      if (previousMarker === null) localStorage.removeItem("taesks.capture-outcome"); else localStorage.setItem("taesks.capture-outcome", previousMarker);
    } catch { /* A retained pending marker remains conservative after failed rollback. */ }
    throw error;
  }
}
export function discardCapture(input: string) {
  localStorage.setItem("taesks.capture-history", JSON.stringify(history().filter(value => value.input !== input)));
  const raw = localStorage.getItem("taesks.capture-outcome");
  if (raw && outcomeSchema.parse(JSON.parse(raw)).input === input) localStorage.removeItem("taesks.capture-outcome");
}
/** Check the current marker inside the same cross-window lock as the operation. */
export async function guardedCapture<T>(input: string, work: () => Promise<T>, expectedRevision?: string | null) {
  return withBrowserLock("taesks-ordinary-capture", async () => {
    if (captureOutcome(input)) throw new Error("Inspect this previous capture in Notion before discarding it. This input will not be replayed.");
    if (expectedRevision !== undefined && captureRevision() !== expectedRevision) throw new Error("Another window already handled a capture while this editor was open. Nothing was sent from this editor. Close it and deliberately start a new capture.");
    return { result: await work() };
  });
}
