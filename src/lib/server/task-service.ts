import "server-only";
import { z } from "zod";
import { addDays, addWeeks, addMonths, addYears, format, parseISO } from "date-fns";
import { taskCreateSchema, taskPatchSchema, taskReconcileSchema, type TaskReconcile, type TaskCreate, type TaskPatch, type TaskMutationResponse } from "@/lib/notion-contracts";
import { recurrenceSchema } from "@/lib/schemas";
import type { DateRange, RecurrenceRule, Task } from "@/lib/types";
import { repository, type createRepository } from "./repository";
import { notion } from "./notion-service";
import type { createNotionAdapter } from "./notion";
import { AppError } from "./http";

type Adapter = Pick<ReturnType<typeof createNotionAdapter>, "createTask" | "getTask" | "updateTask" | "deleteTask">;
type Repository = ReturnType<typeof createRepository>;
export function shiftRecurringDates(dates: DateRange, rule: RecurrenceRule): DateRange {
  const valid = recurrenceSchema.parse(rule);
  const operation = { day: addDays, week: addWeeks, month: addMonths, year: addYears }[valid.frequency];
  const shift = (date: string | null) => date ? format(operation(parseISO(z.iso.date().parse(date)), valid.interval), "yyyy-MM-dd") : null;
  return { start: shift(dates.start), end: shift(dates.end) };
}
export function createTaskService(adapter: Adapter, repo: Repository) {
  async function create(input: TaskCreate): Promise<TaskMutationResponse> {
    const body = taskCreateSchema.parse(input);
    const conversionKeys: { source: "github" | "contact" | "draft"; externalId: string }[] = [
      ...(body.draftId ? [{ source: "draft" as const, externalId: body.draftId }] : []),
      ...(body.source ? [{ source: body.source.source, externalId: body.source.externalId }] : []),
    ];
    if (conversionKeys.length) {
      const snapshot = await repo.snapshot();
      const existing = body.source ? snapshot.externalLinks.find(link => link.source === body.source!.source && link.externalId === body.source!.externalId) : undefined;
      const knownIds = new Set([existing?.taskId, ...conversionKeys.map(key => repo.getExternalConversion(key.source, key.externalId)?.taskId)].filter((id): id is string => typeof id === "string"));
      if (knownIds.size > 1) throw new AppError("CONVERSION_CONFLICT", "This draft and source point to different confirmed tasks. Inspect their links before proceeding.", 409);
      const draft = body.draftId ? snapshot.drafts.find(draft => draft.id === body.draftId) : undefined;
      if (body.draftId && !draft && !repo.getExternalConversion("draft", body.draftId)?.taskId) throw new AppError("DRAFT_UNAVAILABLE", "This Inbox draft no longer exists. Refresh before creating a task.", 404);
      if (draft && ((body.source && (draft.source !== body.source.source || draft.externalId !== body.source.externalId)) || (!body.source && draft.source !== "quick-add"))) throw new AppError("DRAFT_SOURCE", "Keep the draft's original source when converting it.", 422);
      const taskId = [...knownIds][0];
      if (taskId) {
        if (conversionKeys.some(key => repo.getExternalConversion(key.source, key.externalId)?.state === "creating")) throw new AppError("CONVERSION_ACTIVE", "This conversion is still in progress. Wait for its outcome.", 409);
        const task = await adapter.getTask(taskId);
        const warnings: string[] = [];
        let confirmedSnapshot = snapshot;
        try {
          for (const key of conversionKeys) { repo.claimExternalConversion(key.source, key.externalId); repo.finishExternalConversion(key.source, key.externalId, taskId); }
          if (body.source && !existing) await repo.mutate({ action: "linkExternal", ...body.source, taskId });
          confirmedSnapshot = await repo.snapshot();
        } catch { warnings.push(`Task ${taskId} already exists in Notion, but its local conversion context could not be restored. Do not create it again.`); }
        return { task, existing: true, warnings, snapshot: confirmedSnapshot };
      }
      const claimed: typeof conversionKeys = [];
      for (const key of conversionKeys) {
        if (!repo.claimExternalConversion(key.source, key.externalId)) {
          for (const previous of claimed) repo.releaseExternalConversion(previous.source, previous.externalId);
          throw new AppError("CONVERSION_UNCERTAIN", "A conversion is already in progress or its outcome needs review. Check Notion before creating another task.", 409);
        }
        claimed.push(key);
      }
    }
    let task: Task;
    try { task = await adapter.createTask(body.task); }
    catch (error) {
      if (conversionKeys.length) {
        const details = error instanceof AppError && typeof error.details === "object" && error.details !== null ? error.details as { operation?: string; upstreamStatus?: number; taskId?: string } : {};
        const preflight = error instanceof AppError && (["NOTION_DISABLED", "NOTION_CONFIG", "NOTION_SCHEMA", "NOTION_DATA_SOURCE", "NOTION_DATE", "RELATION_UNAVAILABLE", "RELATION_CONFLICT"].includes(error.code) || (details.operation && details.operation !== "task.create"));
        const rejected = details.upstreamStatus && details.upstreamStatus >= 400 && details.upstreamStatus < 500;
        for (const key of conversionKeys) {
          if (details.taskId) repo.finishExternalConversion(key.source, key.externalId, details.taskId);
          else if (preflight || rejected) repo.releaseExternalConversion(key.source, key.externalId);
          else repo.failExternalConversion(key.source, key.externalId);
        }
      }
      throw error;
    }
    const warnings: string[] = [];
    // Once Notion confirms creation, always return that task ID. A local failure
    // must never turn this response into a failed create that invites a duplicate.
    try {
      for (const key of conversionKeys) repo.finishExternalConversion(key.source, key.externalId, task.id);
      if (body.source) {
        await repo.mutate({ action: "linkExternal", ...body.source, taskId: task.id });
      }
      if (body.metadata) await repo.mutate({ action: "setTaskMetadata", taskId: task.id, patch: body.metadata });
      if (body.tags) await repo.mutate({ action: "setTaskTags", taskId: task.id, tags: body.tags });
    } catch { warnings.push(`Task ${task.id} was created in Notion, but some local details could not be saved. Edit this task to recover them; do not create it again.`); }
    let snapshot;
    try { snapshot = await repo.snapshot(); } catch { warnings.push("Local storage is temporarily unavailable."); }
    return { task, warnings, snapshot };
  }
  async function update(id: string, input: TaskPatch): Promise<TaskMutationResponse> {
    const body = taskPatchSchema.parse(input);
    const task = await adapter.updateTask(id, body);
    const warnings: string[] = [];
    if (body.completed !== undefined) {
      try { task.completedAt = await repo.recordCompletion(id, body.completed); }
      catch { warnings.push("Completion saved in Notion; its local timestamp could not be saved."); }
    }
    let nextTask: Task | undefined;
    if (body.completed === true) {
      // Completion itself has succeeded; recurrence errors are explicit warnings,
      // never a misleading failed completion response.
      try {
        const metadata = await repo.getMetadata(id);
        if (metadata.recurrenceRule) {
          const previous = repo.getRecurrence(id);
          if (previous && previous.state !== "complete") warnings.push("The next recurrence has an uncertain outcome. Check Notion; TÆSKS will not create a duplicate automatically.");
          else if (!previous && repo.claimRecurrence(id)) {
            try {
              if (!task.areaId || !task.projectId) throw new AppError("RECURRENCE_RELATIONS", "Resolve this task’s area and project before repeating.");
              const snapshot = await repo.snapshot();
              const tagIds = new Set(snapshot.taskTags.filter(tag => tag.taskId === id).map(tag => tag.tagId));
              nextTask = await adapter.createTask({ title: task.title, areaId: task.areaId, projectId: task.projectId, highlight: task.highlight, dates: shiftRecurringDates(task.dates, metadata.recurrenceRule) });
              // Record remote success before local extensions, so extension errors
              // cannot cause the next completion to create a duplicate instance.
              repo.finishRecurrence(id, nextTask.id);
              await repo.mutate({ action: "setTaskMetadata", taskId: nextTask.id, patch: { priority: metadata.priority, recurrenceRule: metadata.recurrenceRule, someday: metadata.someday } });
              await repo.mutate({ action: "setTaskTags", taskId: nextTask.id, tags: snapshot.tags.filter(tag => tagIds.has(tag.id)).map(tag => tag.name) });
            } catch {
              repo.failRecurrence(id);
              warnings.push(nextTask ? `Next task ${nextTask.id} exists, but local repeat details could not be saved. Edit it directly; do not create it again.` : "Task completed, but creation of its next recurrence was not confirmed. Check Notion before creating a replacement.");
            }
          }
        }
      } catch { warnings.push("Task completed, but repeat settings could not be read from local storage."); }
    }
    let snapshot;
    try { snapshot = await repo.snapshot(); } catch { warnings.push("Local storage is temporarily unavailable."); }
    return { task, nextTask, warnings, snapshot };
  }
  async function reconcile(input: TaskReconcile): Promise<TaskMutationResponse> {
    const body = taskReconcileSchema.parse(input);
    const task = await adapter.getTask(body.taskId);
    if (task.id.replaceAll("-", "").toLowerCase() !== body.taskId.replaceAll("-", "").toLowerCase()) throw new AppError("TASK_NOT_FOUND", "Notion did not confirm the inspected task ID.", 404);
    body.taskId = task.id;
    repo.reconcileConversion(body);
    return { task, existing: true, warnings: [], snapshot: await repo.snapshot() };
  }
  return { create, update, reconcile, delete: (id: string) => adapter.deleteTask(id) };
}
export async function taskService() { return createTaskService(await notion(), repository()); }
