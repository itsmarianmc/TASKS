import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureOutcome, captureRevision, recordCapture, guardedCapture, discardCapture } from "@/lib/capture-guard";

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
  let pending: Promise<unknown> = Promise.resolve();
  vi.stubGlobal("navigator", { locks: { request: (_name: string, work: () => Promise<unknown>) => { const result = pending.then(work); pending = result.catch(() => {}); return result; } } });
});
afterEach(() => vi.unstubAllGlobals());
describe("ordinary capture replay boundary", () => {
  it("serializes two already-open editors and blocks a second create after the first ACK", async () => {
    const write = vi.fn(async () => { recordCapture("same input", "pending"); await Promise.resolve(); recordCapture("same input", "confirmed", "confirmed-id"); localStorage.removeItem("taesks.capture"); });
    const baseline = captureRevision();
    const outcomes = await Promise.allSettled([guardedCapture("same input", write, baseline), guardedCapture("same input", write, baseline)]);
    expect(outcomes.map(value => value.status)).toEqual(["fulfilled", "rejected"]);
    expect(write).toHaveBeenCalledOnce(); expect(JSON.parse(captureRevision()!).taskId).toBe("confirmed-id"); expect(captureOutcome("same input")).toBeNull();
  });
  it("supports more than 100 successful captures and deliberate same-text reuse in a new editor", async () => {
    const baseline = captureRevision();
    for (let index = 0; index < 150; index++) await guardedCapture(`input ${index}`, async () => { recordCapture(`input ${index}`, "pending"); recordCapture(`input ${index}`, "confirmed", `task-${index}`); }, captureRevision());
    expect(JSON.parse(localStorage.getItem("taesks.capture-history")!)).toEqual([]);
    await expect(guardedCapture("input 0", vi.fn(), baseline)).rejects.toThrow("Nothing was sent");
    const deliberatelyNew = vi.fn(); await guardedCapture("input 149", deliberatelyNew, captureRevision()); expect(deliberatelyNew).toHaveBeenCalledOnce();
  });
  it("retains old outcomes across a deliberate different capture and blocks local-draft bypass", async () => {
    recordCapture("old", "uncertain");
    await guardedCapture("new", async () => recordCapture("new", "confirmed"));
    const saveDraft = vi.fn();
    await expect(guardedCapture("old", saveDraft)).rejects.toThrow("will not be replayed"); expect(saveDraft).not.toHaveBeenCalled();
    discardCapture("old"); await guardedCapture("old", saveDraft); expect(saveDraft).toHaveBeenCalledOnce();
  });
  it("fails closed before sending when storage cannot persist the pending marker", async () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("storage full"); });
    const send = vi.fn();
    await expect(guardedCapture("retained", async () => { recordCapture("retained", "pending"); await send(); })).rejects.toThrow("storage full");
    expect(send).not.toHaveBeenCalled();
  });
  it("does not treat corrupt replay storage as absence of a previous outcome", async () => {
    localStorage.setItem("taesks.capture-outcome", "broken"); const send = vi.fn();
    await expect(guardedCapture("retained", send)).rejects.toThrow(); expect(send).not.toHaveBeenCalled();
  });
});
