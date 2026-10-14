"use client";
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
  const context: ParseContext = useMemo(() => ({ timezone: config.data?.timezone ?? "Europe/Berlin", ...captureContext(view, graph), ...sourceContext }), [config.data?.timezone, graph, view, sourceContext]);
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
  return <><Modal open={open} onOpenChange={value => { if (!recovering) { parseRequest.current?.controller.abort(); parseRequest.current = null; onOpenChange(value); } }} title={draft ? "Resolve Inbox draft" : effectiveSource ? "Create linked task" : "Quick add"} className="capture-dialog">
    {created ? <div className="creation-result">
      <p role="status" className="accent">{created.existing ? "Already linked" : "Created in Notion"} / {created.task.title}</p>
      {created.warnings.map((warning, index) => <p role="alert" className="error-text" key={index}>{warning}</p>)}
      {notice && <p role="alert" className="error-text">{notice}</p>}
      <div className="dialog-actions"><a className="button" href={created.task.url} target="_blank" rel="noopener noreferrer">Open in Notion</a><button className="button primary" disabled={pending} onClick={() => onOpenChange(false)}>Done</button></div>
    </div> : added ? <div className="creation-result"><p role="status" className="accent">Task added / {value.title}</p><div className="dialog-actions"><button className="button primary" onClick={() => onOpenChange(false)}>Done</button></div></div> : <form onSubmit={event => { event.preventDefault(); void create(); }}>
      <div className="capture-input"><span aria-hidden="true">&gt;</span><textarea rows={2} aria-label="Task input" placeholder="What needs doing?" value={input} maxLength={10000} disabled={pending || uncertain} autoFocus onChange={event => { parseRequest.current?.controller.abort(); parseRequest.current = null; setUnderstandingFor(null); setInferred(null); setAttemptedFor(null); setInput(event.target.value); setEdited(effectiveSource ? { ...value, title: event.target.value } : null); setManualConfirmed(!!effectiveSource); setNotice(""); }} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (!parseRequest.current) event.currentTarget.form?.requestSubmit(); } }} /></div>
      <div className="capture-preview"><strong className="preview-title">{value.title || "title missing"}</strong><span className="preview-meta"><span>${graph.projects.find(project => project.id === value.projectId)?.name ?? "choose project"}</span><span>@{graph.areas.find(area => area.id === value.areaId)?.name ?? "choose area"}</span>{(value.dates.start || value.dates.end) && <span>{value.dates.start ? previewDate(value.dates.start) : ""}{value.dates.start && value.dates.end ? " → " : value.dates.end ? "→ " : ""}{value.dates.end ? previewDate(value.dates.end) : ""}</span>}{value.tags.map(tag => <span key={tag}>[{tag}]</span>)}{value.priority !== "none" && <span>{value.priority}</span>}{value.recurrenceRule && <span>every {value.recurrenceRule.interval} {value.recurrenceRule.frequency}</span>}{effectiveSource && <span>{effectiveSource.source} · linked</span>}</span></div>
      <details className="capture-fields" open={!!draft || !!effectiveSource || errors.length > 0 || parserWarnings.length > 0 || undefined}><summary aria-label="Edit fields">edit fields</summary><TaskFields value={value} graph={graph} disabled={pending || understanding || uncertain} onChange={next => { setEdited(next); setNotice(""); }} /></details>
      {[...new Set([...parserWarnings, ...errors])].map((warning, index) => <p className="resolution-warning" key={index}>{warning}</p>)}
      {edited && !manualConfirmed && <button type="button" className="button" disabled={pending || uncertain} onClick={() => setManualConfirmed(true)}>Use edited fields</button>}
      <InlineError error={taskMutation.error ?? mutation.error} />{notice && <p role="alert" className="error-text">{notice}</p>}{knownTaskId && <p className="muted">Confirmed Task ID: {knownTaskId}</p>}
      {!online && <p className="resolution-warning">Offline · Save a draft to keep this input on this device.</p>}
      {understanding && <p role="status" className="muted">understanding…</p>}
      <div className="dialog-actions terminal-actions"><button type="button" aria-label={draft ? "Update draft" : "Save draft"} className="text-button" disabled={!input.trim() || pending || understanding || uncertain} onClick={() => void saveDraft()}>{pending && finalizing ? "saving…" : draft ? "update draft" : "save draft"}</button>{canInfer && <button type="button" className="text-button" disabled={pending || understanding || uncertain} onClick={() => void understand()}>understand input</button>}<button className="text-button terminal-create" aria-label={taskMutation.isPending ? "Creating task" : "Create task"} disabled={!online || !!(draft && queued.some(entry => entry.draft.id === draft.id)) || !ready || pending || understanding || uncertain}>{taskMutation.isPending ? "creating…" : "create"} →</button></div>
      <p className="muted capture-hint keyboard-hint">Enter create · Shift Enter new line</p>
      {uncertain && persistence && <button type="button" className="text-button danger-text" onClick={() => setDiscard(true)}>Discard inspected capture</button>}
      {(draft || effectiveSource) && <details className="capture-fields"><summary>Link existing task</summary><p className="muted">Creation unconfirmed? Check Notion, then paste the existing task ID.</p><label>Existing Notion task ID<input aria-label="Existing Notion task ID" value={recoveryId} onChange={event => setRecoveryId(event.target.value)} disabled={pending} /></label><label className="checkbox-label"><input type="checkbox" checked={inspected} onChange={event => setInspected(event.target.checked)} disabled={pending} />I checked this task in Notion. It matches this input.</label><button type="button" className="button" disabled={!online || !inspected || !recoveryId.trim() || pending} onClick={() => void reconcile()}>Verify and link</button></details>}
    </form>}
  </Modal><ConfirmDialog open={discard} onOpenChange={setDiscard} title="Discard this inspected capture?" description="Check Notion first. This permanently discards the input and allows a new capture. The Notion task stays." onConfirm={async () => { await guardedDiscard(); }} /></>;
}
export const Capture = TaskComposer;
function storedOutcome(input: string): { taskId?: string } | null {
  try { return typeof window === "undefined" ? null : captureOutcome(input); } catch { return null; }
}


function previewDate(date: string) { return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)); }
