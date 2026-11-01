"use client";
import { useTranslation } from "./localization";
import { useState, useEffect, useMemo, useRef } from "react";
import { useConfig, useLocal, useLocalMutation } from "@/lib/queries";
import { useTaskMutation } from "@/lib/task-queries";
import { parseQuickAdd } from "@/lib/parser";
import { validateTaskFields, valueToInput, classifyCreateFailure, type TaskFieldsValue } from "@/lib/task-editor";
import { calendarToday } from "@/lib/calendar";
import type { TaskCreate, TaskMutationResponse } from "@/lib/notion-contracts";
import type { Graph, InboxDraft, ParseContext, ParseResult } from "@/lib/types";
import type { AiParseResponse } from "@/lib/ai-contracts";
import { InlineError, Modal, ConfirmDialog } from "./primitives";
import { TaskFields } from "./task-fields";
import { DateChips } from "./date-chips";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queries";
import { putDeviceDraft, readDeviceDrafts, syncDeviceDrafts } from "@/lib/device-drafts";
import { useOnline } from "@/lib/connectivity";
import { useDeviceDrafts } from "./pwa";
import { captureOutcome, captureRevision, latestCaptureOutcome, recordCapture, guardedCapture, discardCapture } from "@/lib/capture-guard";
import { apiRequest } from "@/lib/api-client";
import { withBrowserLock } from "@/lib/browser-lock";
import { captureContext } from "@/lib/view-context";
import { optimisticCache } from "@/lib/optimistic";
import type { LocalSnapshot } from "@/lib/types";
import { clientId } from "@/lib/client-id";

export interface TaskComposerProps {
  open: boolean; onOpenChange: (open: boolean) => void; graph: Graph;
  view?: string; initialTitle?: string; draft?: InboxDraft;
  source?: TaskCreate["source"]; sourceContext?: ParseContext;
  onCreated?: (result: TaskMutationResponse) => void | Promise<void>; onSaved?: (state: "saved" | "queued") => void;
}
/** Shared quick add, draft resolution and explicit external-item conversion. */
export function TaskComposer({ open, onOpenChange, graph, view = "overview", initialTitle, draft, source, sourceContext, onCreated, onSaved }: TaskComposerProps) {
  const { t, text: tx, dateCatalog, locale } = useTranslation();
  const config = useConfig();
  const local = useLocal();
  const mutation = useLocalMutation();
  const taskMutation = useTaskMutation();
  const busy = useRef(false);
  const captureBaseline = useRef((() => { try { return typeof window === "undefined" ? null : captureRevision(); } catch { return null; } })());
  const client = useQueryClient();
  const online = useOnline();
  const queued = useDeviceDrafts();
  const draftId = useRef<string | null>(draft?.id ?? null);
  const [input, setInput] = useState(() => {
    if (draft) return draft.input;
    if (initialTitle !== undefined) return initialTitle;
    try { return typeof window !== "undefined" ? localStorage.getItem("taesks.capture") ?? "" : ""; } catch { return ""; }
  });
  const [edited, setEdited] = useState<TaskFieldsValue | null>(() => {
    if (draft) return { title: draft.title, areaId: draft.areaId, projectId: draft.projectId, dates: draft.dates, tags: draft.tags, priority: draft.priority, recurrenceRule: draft.recurrenceRule, highlight: false };
    if (initialTitle !== undefined || source) {
      const projectId = sourceContext?.projectId ?? captureContext(view, graph).projectId ?? null;
      const project = graph.projects.find(item => item.id === projectId);
      return { title: initialTitle ?? "", areaId: sourceContext?.areaId ?? (project?.areaIds.length === 1 ? project.areaIds[0] : null), projectId, dates: { start: sourceContext?.today ?? calendarToday(sourceContext?.timezone ?? config.data?.timezone), end: null }, tags: [], priority: "none", recurrenceRule: null, highlight: false };
    }
    return null;
  });
  const [manualConfirmed, setManualConfirmed] = useState(!!draft || initialTitle !== undefined || !!source);
  const [created, setCreated] = useState<TaskMutationResponse | null>(null);
  const [added, setAdded] = useState(false);
  const persistence = !draft && initialTitle === undefined && !source;
  const [notice, setNotice] = useState(() => persistence && storedOutcome(input) ? "Creation unconfirmed. Check Notion before discarding or trying again." : "");
  const [uncertain, setUncertain] = useState(() => persistence && !!storedOutcome(input));
  const [knownTaskId, setKnownTaskId] = useState<string | undefined>(() => persistence ? storedOutcome(input)?.taskId : undefined);
  const [discard, setDiscard] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [recoveryId, setRecoveryId] = useState("");
  const [inspected, setInspected] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [understandingFor, setUnderstandingFor] = useState<ParseResult | null>(null);
  const [inferred, setInferred] = useState<{ result: ParseResult; basis: ParseResult } | null>(null);
  const [attemptedFor, setAttemptedFor] = useState<ParseResult | null>(null);
  const parseRequest = useRef<{ id: number; controller: AbortController } | null>(null);
  const parseSequence = useRef(0);
  useEffect(() => {
    if (!persistence || created) return;
    try { if (input) localStorage.setItem("taesks.capture", input); else localStorage.removeItem("taesks.capture"); } catch { /* Input remains in the editor. */ }
  }, [input, persistence, created]);
  useEffect(() => {
    if (!persistence || created) return;
    const changed = () => {
      try {
        const latest = latestCaptureOutcome();
        if (latest?.state === "confirmed" && captureRevision() !== captureBaseline.current) {
          setUncertain(true); setKnownTaskId(latest.taskId); setNotice("Task created in another window. Close this editor before adding another task.");
        } else { const outcome = storedOutcome(input); if (outcome) { setUncertain(true); setKnownTaskId(outcome.taskId); setNotice("Creation unconfirmed. Check Notion before discarding. This input will not be sent again."); } }
      } catch { setNotice("Device storage unavailable. Nothing will be sent; your input stays here."); }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [input, persistence, created]);
  const context: ParseContext = useMemo(() => ({ literalQuotedText: local.data?.preferences.literalQuotedText !== false, dateCatalog, timezone: config.data?.timezone ?? "Europe/Berlin", ...captureContext(view, graph), ...sourceContext }), [config.data?.timezone, graph, view, sourceContext, local.data?.preferences.literalQuotedText, dateCatalog]);
  const deterministic = useMemo(() => parseQuickAdd(input, graph, local.data?.aliases, context, local.data?.tags), [input, graph, local.data?.aliases, local.data?.tags, context]);
  const currentInference = inferred?.basis === deterministic ? inferred.result : null;
  const parsed = currentInference ?? deterministic;
  const understanding = understandingFor === deterministic && open;
  useEffect(() => () => {
    parseRequest.current?.controller.abort(); parseRequest.current = null;
  }, [deterministic, open]);
  const value: TaskFieldsValue = edited ?? { ...parsed, highlight: false };
  const errors = validateTaskFields(value, graph);
  const parserWarnings = manualConfirmed ? [] : parsed.warnings;
  const ready = errors.length === 0 && parserWarnings.length === 0;
  const effectiveSource = source ?? (draft && draft.source !== "quick-add" && draft.externalId ? { source: draft.source, externalId: draft.externalId, url: draft.externalUrl } : undefined);
  const pending = mutation.isPending || taskMutation.isPending || finalizing || recovering;
  const canInfer = !!config.data?.aiFallback?.enabled && online && !!input.trim() && !manualConfirmed && !edited && !currentInference && attemptedFor !== deterministic &&
    (!deterministic.valid || deterministic.confidence < (config.data.aiFallback.confidenceThreshold ?? 0.75)) && !effectiveSource;
  async function understand() {
    if (!canInfer || parseRequest.current || busy.current || uncertain || created) return;
    const controller = new AbortController();
    const id = ++parseSequence.current;
    parseRequest.current = { id, controller }; setUnderstandingFor(deterministic); setNotice("");
    try {
      const response = await apiRequest<AiParseResponse>("/api/parse", { method: "POST", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
        body: JSON.stringify({ input, context: { ...(context.areaId ? { areaId: context.areaId } : {}), ...(context.projectId ? { projectId: context.projectId } : {}) } }) });
      if (controller.signal.aborted || parseRequest.current?.id !== id) return;
      setAttemptedFor(deterministic);
      if (response.fallback === "accepted") { setInferred({ result: response.result, basis: deterministic }); setNotice("Review the fields, then create the task."); }
      else setNotice("Couldn't infer all fields. Choose manually.");
    } catch {
      if (!controller.signal.aborted && parseRequest.current?.id === id) { setAttemptedFor(deterministic); setNotice("Couldn't infer all fields. Choose manually."); }
    } finally {
      if (parseRequest.current?.id === id) { parseRequest.current = null; setUnderstandingFor(null); }
    }
  }
  function clearBrowserInput() { if (persistence) { try { localStorage.removeItem("taesks.capture"); } catch { /* Input remains available in this session. */ } } }
  async function saveDraft() {
    if (busy.current || parseRequest.current || uncertain) return;
    if (!persistence) return saveDraftInner();
    try {
      const result = await guardedCapture(input, saveDraftInner, captureBaseline.current);
      if (!result) setNotice("Another window is handling this capture. Your input stays here.");
    } catch (error) { setNotice(error instanceof SyntaxError ? "Device storage unavailable. No task was sent; your input stays here." : error instanceof Error ? `${error.message} Your input stays here.` : "Device storage is unavailable. No task was sent; your input stays here."); }
  }
  async function saveDraftInner() {
    if (busy.current || created || !input.trim()) return;
    busy.current = true;
    try {
      const dates = value.dates.start && value.dates.end && value.dates.end < value.dates.start ? { start: null, end: null } : value.dates;
      draftId.current ??= clientId();
      const now = new Date().toISOString();
      putDeviceDraft({ id: draftId.current, input, title: value.title, areaId: value.areaId, projectId: value.projectId, dates, tags: value.tags, priority: value.priority, recurrenceRule: value.recurrenceRule, source: effectiveSource?.source ?? "quick-add", externalId: effectiveSource?.externalId ?? null, externalUrl: effectiveSource?.url ?? null, createdAt: draft?.createdAt ?? now, updatedAt: now });
      setFinalizing(true);
      let state: "saved" | "queued" = "queued";
      clearBrowserInput(); onOpenChange(false); onSaved?.(state);
      if (online) { try { await syncDeviceDrafts(snapshot => optimisticCache(client).merge<LocalSnapshot>(queryKeys.local, old => old && { ...old, drafts: snapshot.drafts })); if (!readDeviceDrafts().some(entry => entry.draft.id === draftId.current)) state = "saved"; } catch { /* Durable entry waits for acknowledgement. */ } }
    } catch { setNotice("Device storage is unavailable or full. Your input stays here; free storage before saving an offline draft."); } finally { busy.current = false; setFinalizing(false); }
  }
  async function create() {
    if (busy.current || parseRequest.current || created || uncertain) return;
    if (canInfer) return understand();
    if (!persistence) return createInner();
    try {
      const result = await guardedCapture(input, createInner, captureBaseline.current);
      if (!result) setNotice("Another window is handling this capture. Your input stays here.");
    } catch (error) {
      setNotice(error instanceof Error ? `${error.message} No task was sent from this editor; your input stays here.` : "Device storage is unavailable. No task was sent; your input stays here.");
      if (storedOutcome(input)) setUncertain(true);
    }
  }
  async function createInner() {
    if (busy.current || created || uncertain) return;
    if (!online || (draft && queued.some(entry => entry.draft.id === draft.id))) { setNotice("Draft waiting to sync. Reconnect before creating a task. Your input stays here."); return; }
    if (!ready) { setNotice("Choose the missing fields or save a draft."); return; }
    busy.current = true;
    if (persistence) {
      try { recordCapture(input, "pending"); }
      catch { busy.current = false; setNotice("Device storage is unavailable or full. Your input stays here; no task was sent. Restore storage before creating."); return; }
    }
    setAdded(true);
    try {
      const result = await taskMutation.mutateAsync({ kind: "create", body: { task: valueToInput(value), ...(draft ? { draftId: draft.id } : {}), metadata: { priority: value.priority, recurrenceRule: value.recurrenceRule }, tags: value.tags, ...(effectiveSource ? { source: effectiveSource } : {}) } });
      if (!result) return;
      setCreated(result); setFinalizing(true);
      if (persistence) { try { recordCapture(input, "confirmed", result.task.id); } catch { /* The pending marker still blocks replay. */ } }
      clearBrowserInput();
      if (draft) {
        try { await mutation.mutateAsync({ action: "deleteDraft", id: draft.id }); }
        catch { setNotice("Task created. Local draft cleanup failed; remove the draft after checking this task. Do not create it again."); }
      }
      try { await onCreated?.(result); }
      catch { setNotice(previous => `${previous ? `${previous} ` : ""}Task created. Refresh failed; check Notion and do not create it again.`); }
    } catch (error) {
      setAdded(false);
      const outcome = classifyCreateFailure(error);
      if (outcome.uncertain) {
        setUncertain(true); setKnownTaskId(outcome.taskId); setNotice(outcome.taskId ? `Task ${outcome.taskId} created. Refresh Notion; do not create it again.` : "Creation unconfirmed. Check Notion before trying again. This input will not be sent again.");
        if (persistence) { try { recordCapture(input, "uncertain", outcome.taskId); } catch { /* The pending marker still blocks replay. */ } }
      } else if (persistence) {
        try { discardCapture(input); captureBaseline.current = captureRevision(); } catch { /* The marker remains conservative if cleanup fails. */ }
      }
      if (!persistence && !draft) {
        try {
          const now = new Date().toISOString();
          putDeviceDraft({ id: clientId(), input: input || value.title, title: value.title, areaId: value.areaId, projectId: value.projectId, dates: value.dates, tags: value.tags, priority: value.priority, recurrenceRule: value.recurrenceRule, source: effectiveSource?.source ?? "quick-add", externalId: effectiveSource?.externalId ?? null, externalUrl: effectiveSource?.url ?? null, createdAt: now, updatedAt: now });
        } catch { /* The source still provides the original input. */ }
      }
    } finally { busy.current = false; setFinalizing(false); }
  }
  async function reconcile() {
    if (!inspected || !recoveryId.trim() || recovering) return;
    setRecovering(true);
    try {
      const result = await apiRequest<TaskMutationResponse>("/api/tasks/reconcile", { method: "POST", body: JSON.stringify({ taskId: recoveryId.trim(), inspected: true, ...(draft ? { draftId: draft.id } : {}), ...(effectiveSource ? { source: effectiveSource } : {}) }) });
      if (result.snapshot) optimisticCache(client).merge<LocalSnapshot>(queryKeys.local, old => old && { ...old, drafts: result.snapshot!.drafts, externalLinks: result.snapshot!.externalLinks });
      setCreated(result); setUncertain(false); setNotice("");
      await onCreated?.(result);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The existing task could not be verified."); }
    finally { setRecovering(false); }
  }
  async function guardedDiscard() {
    await withBrowserLock("taesks-ordinary-capture", async () => { discardCapture(input); clearBrowserInput(); onOpenChange(false); });
  }
  return <><Modal open={open} onOpenChange={value => { if (!recovering) { parseRequest.current?.controller.abort(); parseRequest.current = null; onOpenChange(value); } }} title={draft ? t("ui.resolve_inbox_draft") : effectiveSource ? t("ui.create_linked_task") : t("ui.quick_add_c372877")} className="capture-dialog">
    {created ? <div className="creation-result">
      <p role="status" className="accent">{created.existing ? t("ui.already_linked") : t("ui.synced_to_notion")} / {created.task.title}</p>
      {created.warnings.map((warning, index) => <p role="alert" className="error-text" key={index}>{tx(warning)}</p>)}
      {notice && <p role="alert" className="error-text">{tx(notice)}</p>}
      <div className="dialog-actions"><a className="button" href={created.task.url} target="_blank" rel="noopener noreferrer">{t("ui.open_in_notion")}</a><button className="button primary" disabled={pending} onClick={() => onOpenChange(false)}>{t("ui.done_e9b450d")}</button></div>
    </div> : added ? <div className="creation-result"><p role="status" className="accent">{t("ui.task_added")}{" "}{value.title}</p><div className="dialog-actions"><button className="button primary" onClick={() => onOpenChange(false)}>{t("ui.done_e9b450d")}</button></div></div> : <form onSubmit={event => { event.preventDefault(); void create(); }}>
      <div className="capture-input"><span aria-hidden="true">{">"}</span><textarea rows={2} aria-label={t("ui.task_input")} placeholder={t("ui.what_needs_doing")} value={input} maxLength={10000} disabled={pending || uncertain} autoFocus onChange={event => { parseRequest.current?.controller.abort(); parseRequest.current = null; setUnderstandingFor(null); setInferred(null); setAttemptedFor(null); setInput(event.target.value); setEdited(effectiveSource ? { ...value, title: event.target.value } : null); setManualConfirmed(!!effectiveSource); setNotice(""); }} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (!parseRequest.current) event.currentTarget.form?.requestSubmit(); } }} /></div>
      <div className="capture-preview"><strong className="preview-title">{value.title || t("ui.title_missing")}</strong><span className="preview-meta"><span className="meta-chip meta-project">${graph.projects.find(project => project.id === value.projectId)?.name ?? t("ui.choose_project")}</span><span className="meta-chip meta-area">@{graph.areas.find(area => area.id === value.areaId)?.name ?? t("ui.choose_area")}</span>{(value.dates.start || value.dates.end) && <span className="task-dates"><DateChips start={value.dates.start} end={value.dates.end} formatDate={date => previewDate(date, locale)} /></span>}{value.tags.map(tag => <span key={tag}>[{tag}]</span>)}{value.priority !== "none" && <span>{tx(value.priority)}</span>}{value.recurrenceRule && <span>{t("ui.every")}{" "}{value.recurrenceRule.interval} {value.recurrenceRule.frequency}</span>}{effectiveSource && <span>{effectiveSource.source} {" "}{t("ui.linked_4e7a5ab")}</span>}</span></div>
      <details className="capture-fields" open={!!draft || !!effectiveSource || errors.length > 0 || parserWarnings.length > 0 || undefined}><summary aria-label={t("ui.edit_fields")}>{t("ui.edit_fields_4be4662")}</summary><TaskFields value={value} graph={graph} disabled={pending || understanding || uncertain} onChange={next => { setEdited(next); setNotice(""); }} /></details>
      {[...new Set([...parserWarnings, ...errors])].map((warning, index) => <p className="resolution-warning" key={index}>{tx(warning)}</p>)}
      {edited && !manualConfirmed && <button type="button" className="button" disabled={pending || uncertain} onClick={() => setManualConfirmed(true)}>{t("ui.use_edited_fields")}</button>}
      <InlineError error={taskMutation.error ?? mutation.error} />{notice && <p role="alert" className="error-text">{tx(notice)}</p>}{knownTaskId && <p className="muted">{t("ui.confirmed_task_id")}{" "}{knownTaskId}</p>}
      {!online && <p className="resolution-warning">{t("ui.offline_save_a_draft_to_keep_this_input_on_this_device")}</p>}
      {understanding && <p role="status" className="muted">{t("ui.understanding")}</p>}
      <div className="dialog-actions terminal-actions"><button type="button" aria-label={draft ? t("ui.update_draft") : t("ui.save_draft")} className="text-button" disabled={!input.trim() || pending || understanding || uncertain} onClick={() => void saveDraft()}>{pending && finalizing ? t("ui.saving") : draft ? t("ui.update_draft_3b9c21e") : t("ui.save_draft_49a6996")}</button>{canInfer && <button type="button" className="text-button" disabled={pending || understanding || uncertain} onClick={() => void understand()}>{t("ui.understand_input")}</button>}<button className="text-button terminal-create" aria-label={taskMutation.isPending ? t("ui.creating_task") : t("ui.create_task")} disabled={!online || !!(draft && queued.some(entry => entry.draft.id === draft.id)) || !ready || pending || understanding || uncertain}>{taskMutation.isPending ? t("ui.creating") : t("ui.create")} →</button></div>
      <p className="muted capture-hint keyboard-hint">{t("ui.enter_create_shift_enter_new_line")}</p>
      {uncertain && persistence && <button type="button" className="text-button danger-text" onClick={() => setDiscard(true)}>{t("ui.discard_inspected_capture")}</button>}
      {(draft || effectiveSource) && <details className="capture-fields"><summary>{t("ui.link_existing_task")}</summary><p className="muted">{t("ui.creation_unconfirmed_check_notion_then_paste_the_existing_task_id")}</p><label>{t("ui.existing_notion_task_id")}<input aria-label={t("ui.existing_notion_task_id")} value={recoveryId} onChange={event => setRecoveryId(event.target.value)} disabled={pending} /></label><label className="checkbox-label"><input type="checkbox" checked={inspected} onChange={event => setInspected(event.target.checked)} disabled={pending} />{t("ui.i_checked_this_task_in_notion_it_matches_this_input")}</label><button type="button" className="button" disabled={!online || !inspected || !recoveryId.trim() || pending} onClick={() => void reconcile()}>{t("ui.verify_and_link")}</button></details>}
    </form>}
  </Modal><ConfirmDialog open={discard} onOpenChange={setDiscard} title={t("ui.discard_this_inspected_capture")} description={t("ui.check_notion_first_this_permanently_discards_the_input_and_allows_a_new_capture_the_notion_task")} onConfirm={async () => { await guardedDiscard(); }} /></>;
}
export const Capture = TaskComposer;
function storedOutcome(input: string): { taskId?: string } | null {
  try { return typeof window === "undefined" ? null : captureOutcome(input); } catch { return null; }
}


function previewDate(date: string, locale: string) { return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)); }
