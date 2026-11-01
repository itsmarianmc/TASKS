import { describe, expect, it, vi } from "vitest";
import { CompletionController, type CompletionEntry } from "@/lib/completion";
import type { TaskMutationResponse } from "@/lib/notion-contracts";
const result = (id: string, completed: boolean) => ({ task: { id, completed }, warnings: [] }) as unknown as TaskMutationResponse;
function setup() { let entries: CompletionEntry[] = []; const controller = new CompletionController(value => { entries = value; }); return { controller, entries: () => entries }; }
describe("serialized completion Undo", () => {
  it.each([false, true])("reverses exact completion state %s even without the row", async completed => {
    const state = setup(), write = vi.fn(async (id, value) => result(id, value));
    await state.controller.change({ id: "task", completed }, write);
    expect(state.entries()[0].state).toBe("confirmed");
    await state.controller.undo(state.entries()[0].token);
    expect(write.mock.calls).toEqual([["task", !completed], ["task", completed]]); expect(state.entries()).toEqual([]);
  });
  it("queues Undo while pending and ignores duplicate rapid actions", async () => {
    const state = setup(); let resolve!: (value: TaskMutationResponse) => void;
    const write = vi.fn().mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockImplementation(async (id, value) => result(id, value));
    const pending = state.controller.change({ id: "a", completed: false }, write);
    const token = state.entries()[0].token;
    await state.controller.change({ id: "a", completed: true }, write);
    await state.controller.undo(token); await state.controller.undo(token);
    expect(write).toHaveBeenCalledTimes(1); expect(state.entries()[0].state).toBe("pending");
    resolve(result("a", true)); await pending;
    expect(write.mock.calls).toEqual([["a", true], ["a", false]]); expect(state.entries()).toEqual([]);
  });
  it("never confirms or runs Undo when the initial mutation fails", async () => {
    const state = setup(); let reject!: (error: Error) => void;
    const write = vi.fn(() => new Promise<TaskMutationResponse>((_, fail) => { reject = fail; }));
    const pending = state.controller.change({ id: "a", completed: false }, write);
    await state.controller.undo(state.entries()[0].token); reject(new Error("failed"));
    await expect(pending).rejects.toThrow("failed"); expect(write).toHaveBeenCalledTimes(1); expect(state.entries()).toEqual([]);
  });
  it("surfaces Undo errors without a success toast or duplicate inverse write", async () => {
    const state = setup(), write = vi.fn().mockResolvedValueOnce(result("a", true)).mockRejectedValueOnce(new Error("reopen failed"));
    await state.controller.change({ id: "a", completed: false }, write); const token = state.entries()[0].token;
    await expect(state.controller.undo(token)).rejects.toThrow("reopen failed"); await state.controller.undo(token);
    expect(write).toHaveBeenCalledTimes(2); expect(state.entries()).toEqual([]);
  });
});
