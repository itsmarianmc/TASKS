import type { Task } from "./types";
import type { TaskMutationResponse } from "./notion-contracts";

export interface CompletionEntry { id: string; token: number; before: boolean; state: "pending" | "confirmed" | "undoing"; undoRequested: boolean }
type Write = (id: string, completed: boolean) => Promise<TaskMutationResponse | null>;
/** One lane per task; Undo waits for a confirmed original write. The mutation cache owns rollback/errors. */
export class CompletionController {
  private entries = new Map<string, CompletionEntry>();
  private writes = new Map<number, Write>();
  private sequence = 0;
  constructor(private publish: (entries: CompletionEntry[]) => void) {}
  private emit() { this.publish([...this.entries.values()].map(entry => ({ ...entry }))); }
  async change(task: Pick<Task, "id" | "completed">, write: Write) {
    const current = this.entries.get(task.id);
    if (current && current.state !== "confirmed") return null;
    const entry: CompletionEntry = { id: task.id, token: ++this.sequence, before: task.completed, state: "pending", undoRequested: false };
    if (current) this.writes.delete(current.token);
    this.entries.set(task.id, entry); this.writes.set(entry.token, write); this.emit();
    try {
      const result = await write(task.id, !task.completed);
      if (!result || result.task.completed !== !task.completed) { this.dismiss(entry.token); return result; }
      entry.state = "confirmed"; this.emit();
      if (entry.undoRequested) return await this.undo(entry.token) ?? result;
      return result;
    } catch (error) { this.dismiss(entry.token); throw error; }
  }
  async undo(token: number) {
    const entry = [...this.entries.values()].find(value => value.token === token);
    if (!entry || entry.state === "undoing") return;
    entry.undoRequested = true;
    if (entry.state === "pending") { this.emit(); return; }
    entry.state = "undoing"; this.emit();
    try { return await this.writes.get(token)!(entry.id, entry.before); }
    finally { this.dismiss(token); }
  }
  dismiss(token: number) {
    const entry = [...this.entries.values()].find(value => value.token === token);
    if (entry) this.entries.delete(entry.id);
    this.writes.delete(token); this.emit();
  }
}
