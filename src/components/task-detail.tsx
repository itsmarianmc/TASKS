"use client";
import { useTranslation } from "./localization";
import { useState, useRef, useEffect, useEffectEvent } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import type { Graph, LocalSnapshot, Task } from "@/lib/types";
import { useLocalMutation } from "@/lib/queries";
import { useCompletion } from "@/lib/completion-queries";
import { useTaskMutation } from "@/lib/task-queries";
import { validateTaskFields, valueToInput, type TaskFieldsValue } from "@/lib/task-editor";
import { EntityPanel } from "./entity-panel";
import { TerminalToggle } from "./terminal-toggle";
import { TaskFields } from "./task-fields";
import { Modal, ConfirmDialog } from "./primitives";
import { toDeviceDateTime, reminderSchedulingPatch } from "@/lib/reminders";
import { coreFields, readTaskEdit, storeTaskEdit, reconcileTaskEdit } from "@/lib/task-edit-drafts";

export function TaskDetail({ task, graph, local, onClose, completionEnabled = false }: { task: Task | null; graph: Graph; local: LocalSnapshot; onClose: () => void; completionEnabled?: boolean }) {
  const { t } = useTranslation();
  const [retained, setRetained] = useState(task);
  if (task && task !== retained) setRetained(task);
  const current = task ?? retained;
  return <Modal modal={false} open={!!task} onOpenChange={open => { if (!open) onClose(); }} title={current?.title ?? t("ui.task_7bb0ddf")} className="inspector-dialog task-drawer">
    {current && <TaskInspector key={current.clientKey ?? current.id} open={!!task} task={current} graph={graph} local={local} onClose={onClose} completionEnabled={completionEnabled} />}
  </Modal>;
}
function TaskInspector({ open, task, graph, local, onClose, completionEnabled }: { open: boolean; task: Task; graph: Graph; local: LocalSnapshot; onClose: () => void; completionEnabled: boolean }) {
  const { t, text: tx } = useTranslation();
  const mutation = useLocalMutation(), remote = useTaskMutation();
  const completeTask = useCompletion();
  const metadata = local.metadata.find(value => value.taskId === task.id);
  const [editKey] = useState(`taesks.task-edit:${task.clientKey ?? task.id}`);
  const draftBase = useRef(coreFields(task));
  const localValue = { priority: metadata?.priority ?? "none", recurrenceRule: metadata?.recurrenceRule ?? null, tags: local.taskTags.filter(tag => tag.taskId === task.id).flatMap(tag => local.tags.find(item => item.id === tag.tagId)?.name ?? []) };
  const [value, setValue] = useState<TaskFieldsValue>(() => ({ ...readTaskEdit(editKey, task), priority: metadata?.priority ?? "none", recurrenceRule: metadata?.recurrenceRule ?? null, tags: local.taskTags.filter(tag => tag.taskId === task.id).flatMap(tag => local.tags.find(item => item.id === tag.tagId)?.name ?? []) }));
  const baseline = useRef({ title: task.title, areaId: task.areaId, projectId: task.projectId, dates: task.dates, highlight: task.highlight });
  const editVersion = useRef(0), saveVersion = useRef(0);
  const [reminder, setReminder] = useState(() => toDeviceDateTime(metadata?.reminderAt ?? null));
  const [trash, setTrash] = useState(false), [warnings, setWarnings] = useState<string[]>([]), [notice, setNotice] = useState("");
  const errors = validateTaskFields(value, graph);
  async function saveCore(next = value) {
    if (validateTaskFields(next, graph).length) return;
    const input = valueToInput(next), previous = baseline.current;
    const changes = Object.fromEntries(Object.entries(input).filter(([key, field]) => JSON.stringify(field) !== JSON.stringify(previous[key as keyof typeof previous]))) as Partial<typeof input>;
    if (!Object.keys(changes).length) return;
    const save = ++saveVersion.current, edit = editVersion.current;
    baseline.current = { ...input, highlight: input.highlight ?? false }; setNotice(""); setWarnings([]);
    try {
      const result = await remote.mutateAsync({ kind: "patch", id: task.id, body: { task: changes } });
      if (result && save === saveVersion.current) {
        setWarnings(result.warnings);
        baseline.current = { title: result.task.title, areaId: result.task.areaId, projectId: result.task.projectId, dates: result.task.dates, highlight: result.task.highlight };
        for (const key of new Set([editKey, `taesks.task-edit:${result.task.id}`])) reconcileTaskEdit(key, { ...input, highlight: input.highlight ?? false }, baseline.current); draftBase.current = baseline.current;
        if (edit === editVersion.current) setValue(current => ({ ...current, ...baseline.current }));
      }
    } catch { if (save === saveVersion.current) { baseline.current = previous; setValue(current => ({ ...current, highlight: previous.highlight })); setNotice("Unsaved changes. Your text stays here."); } }
  }
  async function complete() {
    if (!completionEnabled) return;
    const previous = baseline.current, save = saveVersion.current;
    try {
      const result = await completeTask(task);
      if (!result || save !== saveVersion.current) return;
      const confirmed = { title: result.task.title, areaId: result.task.areaId, projectId: result.task.projectId, dates: result.task.dates, highlight: result.task.highlight };
      setValue(current => ({ ...current, ...Object.fromEntries(Object.entries(confirmed).filter(([key]) => JSON.stringify(current[key as keyof typeof confirmed]) === JSON.stringify(previous[key as keyof typeof confirmed]))) }));
      baseline.current = confirmed; setWarnings(result.warnings);
      for (const key of new Set([editKey, `taesks.task-edit:${result.task.id}`])) reconcileTaskEdit(key, previous, confirmed); draftBase.current = confirmed;
    } catch { /* The cache rolls back and global feedback survives closing this editor. */ }
  }
  function changeLocal(next: TaskFieldsValue) {
    editVersion.current++; setValue(next);
    if (JSON.stringify(next.tags) !== JSON.stringify(localValue.tags)) mutation.mutate({ action: "setTaskTags", taskId: task.id, tags: next.tags });
    if ((next.priority !== localValue.priority || JSON.stringify(next.recurrenceRule) !== JSON.stringify(localValue.recurrenceRule)) && (!next.recurrenceRule || (next.recurrenceRule.interval >= 1 && next.recurrenceRule.interval <= 365))) mutation.mutate({ action: "setTaskMetadata", taskId: task.id, patch: { priority: next.priority, recurrenceRule: next.recurrenceRule } });
  }
  function saveReminder() {
    try {
      const patch = reminderSchedulingPatch(reminder, metadata?.reminderAt ?? null);
      mutation.mutate({ action: "setTaskMetadata", taskId: task.id, patch });
      setNotice("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Choose a valid reminder."); }
  }
  function changeCore(next: TaskFieldsValue) {
    editVersion.current++; setValue(next);
    if (next.highlight !== value.highlight) void saveCore(next);
    try { for (const key of new Set([editKey, `taesks.task-edit:${task.id}`])) storeTaskEdit(key, draftBase.current, next); } catch { setNotice("Device copy unavailable. Your edits stay in this editor."); }
  }
  const autosave = useEffectEvent(() => { if (!trash) void saveCore(); });
  useEffect(() => () => autosave(), []);
  useEffect(() => {
    if (!open) { autosave(); return; }
    const timer = setTimeout(() => autosave(), 500);
    return () => clearTimeout(timer);
  }, [value.title, value.areaId, value.projectId, value.dates.start, value.dates.end, value.highlight, open]);

  return <>
    <div className="inspector-content" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) void saveCore(); }}>
      <div className="detail-path"><span className="meta-chip meta-area">{graph.areas.find(area => area.id === task.areaId)?.name ?? t("ui.missing_area")}</span><span>/</span><span className="meta-chip meta-project">${graph.projects.find(project => project.id === task.projectId)?.name ?? t("ui.missing_project")}</span><span className="tag">{task.completed ? t("ui.completed") : t("ui.open")}</span></div>
      <div onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) void saveCore(); }}><TaskFields value={value} onChange={changeCore} graph={graph} local={false} localizedDates /></div>
      {errors.map((error, index) => <p className="resolution-warning" key={index}>{tx(error)}</p>)}
      <div className="inline-actions inspector-actions"><button className="button" disabled={!completionEnabled} title={!completionEnabled ? t("ui.configure_the_completion_property_in_settings") : undefined} onClick={() => void complete()}>{task.completed ? t("ui.reopen") : t("ui.complete")}</button><button className="icon-button danger-text" aria-label={t("ui.trash_task")} onClick={() => setTrash(true)}><Trash2 size={14} /></button></div>
      {!completionEnabled && <p className="muted">{t("ui.completion_unavailable_configure_it_in_settings")}</p>}
      <details className="local-scheduling"><summary>{t("ui.scheduling_tags")}</summary>
        <TaskFields value={{ ...value, ...localValue, tagsText: value.tagsText }} onChange={changeLocal} graph={graph} core={false} />
        <div className="form-grid"><div className="full-field"><TerminalToggle label={t("ui.someday_bcf0537")} checked={metadata?.someday ?? false} onChange={someday => mutation.mutate({ action: "setTaskMetadata", taskId: task.id, patch: { someday } })} /></div><label className="full-field">{t("ui.reminder_b87a192")}<input aria-label={t("ui.task_reminder")} type="datetime-local" value={reminder} onChange={event => setReminder(event.target.value)} onBlur={saveReminder} /></label></div>
      </details>
      {notice && <p role="status" className="muted operation-status">{tx(notice)}</p>}{warnings.map((warning, index) => <p className="error-text" role="alert" key={index}>{tx(warning)}</p>)}
      <div className="detail-sources">{task.url && <a className="source-link" href={task.url} target="_blank" rel="noopener noreferrer">{t("ui.open_in_notion")}{" "}<ExternalLink size={12} /></a>}{local.externalLinks.filter(link => link.taskId === task.id).map(link => <p key={link.id}>{link.url ? <a className="source-link" href={link.url} target="_blank" rel="noopener noreferrer">{link.source} / {link.externalId} <ExternalLink size={12} /></a> : <span className="muted">{link.source} / {link.externalId}</span>}</p>)}</div>
      <EntityPanel key={`task:${task.clientKey ?? task.id}`} entity={{ type: "task", id: task.id }} snapshot={local} />
    </div>
    <ConfirmDialog optimistic open={trash} onOpenChange={setTrash} title={t("ui.trash_this_notion_task")} description={t("ui.this_moves_the_task_to_notion_trash")} onConfirm={async () => { const result = remote.mutateAsync({ kind: "delete", id: task.id }); onClose(); await result; }} />
  </>;
}
