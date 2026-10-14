# Core task interaction and adapter handoff

## Immediate intent, confirmed persistence

Quick add runs `parseQuickAdd` synchronously against the actual Notion graph, persisted aliases and known tags, using the app timezone from `/api/config`. The original input remains editable and is retained in browser storage. A compact preview lists title, project, area, dates, tags, priority, recurrence and confidence. Valid capture keeps the editing form collapsed. Missing/conflicting assignments expose correction fields and warnings immediately. Selecting a single-area project fills its area; a multi-area project needs a compatible explicit selection. Natural-parser warnings require deliberate **Use edited fields** after correction. Enter creates only a validated task. Unresolved input stays available and can be saved explicitly as a local Inbox draft.

Task creation uses `POST /api/tasks`; core editing, complete and reopen use `PATCH /api/tasks/:id`; trash uses `DELETE` with the branded confirmation and `{confirmed:true}`. Rows and the inspector apply validated intents immediately and remain usable during persistence. `useTaskMutation` cancels affected reads, patches the shared graph/local cache, serializes writes per entity, reconciles confirmed IDs and rolls back only the failed intent. Create inserts a temporary UUID task and advances the composer immediately. Normal writes do not refetch the whole graph. See `OPTIMISTIC.md` for the full audit and ordering contract. Confirmed IDs and server warnings remain visible in the result/inspector. Recurrence warnings never prompt automatic retries.

The inspector compares editable fields to its editor baseline, sends only user changes, and reconciles untouched fields from confirmed responses. Remote changes to an untouched title/relation/date are not written back as stale editor values. Core and local saves are distinct: tags, priority, repeat interval, Someday and reminders are local metadata. Reminder entry explicitly uses the device timezone and stores an absolute UTC instant; notification delivery belongs to the subsequent PWA/reminder phase. Local save errors retain values and indicate any already confirmed partial save.

## Durable conversion protection

`TaskCreate` adds optional `draftId`. Migration 3 creates `draft_conversion_ledger`, storing only draft ID → confirmed Notion ID and conversion state. This does not persist Notion task core. The supplied draft must exist unless its ledger already has a confirmed task. External drafts must retain their original GitHub/Contact source ID. Separate atomic draft and source claims prevent concurrent/restarted conversion duplicates; a failed second claim releases the first. Definite validation/read/rejected-write failures release claims. Unknown task-create outcomes retain them. Known remote IDs are recorded even when response decoding fails. Existing confirmed tasks restore missing local source links safely, without overwriting their metadata or tags; local recovery failures return warnings alongside that confirmed task.

The client deletes a local draft only after remote creation/lookup succeeds. Cleanup failure retains the confirmed ID and a clear warning. Reopening the retained draft uses its ledger and returns the existing task rather than creating another, even across process restarts.

Ordinary quick add has a durable browser replay guard. The editor records its initial capture revision. A Web Lock (IndexedDB lease fallback) serializes the current-marker check and POST across already-open windows. Before sending, pending input/marker/history must persist and read back; storage or lock failure sends no task and retains editable input. Partial preflight storage writes are rolled back. A confirmed marker remains as the revision boundary, so an old second editor cannot create again after the first ACK clears the input. Confirmed captures do not accumulate in the history or impose a capture-count limit; a deliberately reopened new editor can capture the same text again. Uncertain inputs and any known task ID stay in history until **Discard inspected capture**, with branded confirmation after Notion inspection. Save draft shares the ordinary guard and cannot bypass uncertainty. Source/draft conversions additionally have server ledgers.

Draft and external composers expose **Link an inspected existing task**. The user enters a Notion task ID and explicitly checks the inspection box. `POST /api/tasks/reconcile` performs scoped Notion GET validation, then atomically restores the original draft/source ledgers and source link. It performs no Notion create/update. Active creates and conflicting confirmed task IDs are rejected; a saved draft's source cannot be retargeted. On the supported single-process server's first database connection, interrupted persisted creates become uncertain before any new request can claim them, allowing explicit recovery after a crash. Ordinary repository construction/request handling never resets active claims.

`ApiClientError` retains safe server `details` so the client distinguishes schema/graph preflight from actual `task.create` uncertainty. Not every 5xx locks a known rejected/preflight operation. Unknown network outcomes, actual unconfirmed creates and `CONVERSION_UNCERTAIN` block replay.

## Reusable external conversion component

Import `TaskComposer` and `TaskComposerProps` from `src/components/capture.tsx` (`Capture` remains a compatible alias). Mount it only while open, and key it by draft/source identity to initialize a different capture cleanly.

```tsx
<TaskComposer
  key={`github:${item.id}`}
  open
  onOpenChange={setOpen}
  graph={graph}
  initialTitle={item.title}
  source={{ source: "github", externalId: item.id, url: item.url }}
  sourceContext={{ projectId, areaId, timezone }}
  onCreated={(result) => { /* refresh source linkage / announce confirmed ID */ }}
  onSaved={() => { /* open Inbox if desired */ }}
/>
```

`source` supports `github|contact`, a stable ID and nullable validated HTTP/HTTPS URL. `sourceContext` is the shared `ParseContext` (`projectId`, `areaId`, `timezone`, optional explicit `today`). External `initialTitle` is initialized verbatim in manual fields: issue numbers, calendar words and punctuation are not stripped by natural parsing. Its textarea edits preserve that manual source-title behavior. Single-area project defaults are inferred. No external task is created until the user confirms with Create task and all required fields validate. `onCreated` receives `TaskMutationResponse` including warnings, existing linkage and snapshot; the composer remains open with its confirmed result until Done. The callback may return a Promise; it is awaited separately from creation, and a callback/source-refresh failure becomes a confirmed-task warning instead of a failed create. Do not close it prematurely or hide warnings. To resolve a saved item, pass the complete `draft`; its source and original raw input are retained.

## Views, search and keyboard

`tasksForView`, `taskSections` and `viewTaskCount` in `src/lib/views.ts` jointly drive navigation/list counts and content. Entity/tag pages group active, collapsed Someday and collapsed completed records; their active counts exclude the latter two. Explicit completed saved filters count their matching completed results. Overview partitions overdue, current daily highlights, today, unresolved tasks, upcoming and unscheduled, and shows the local draft Inbox summary. Future highlights are not labeled daily. Upcoming groups chronologically by ISO calendar date. Project headers show status/priority/deadline and completion progress; area headers show Type. Task rows show calendar-day lateness in app-local dates.

The palette groups actual commands, views, areas, projects, filters, tasks, drafts, tags, note content and attachment metadata. Notes/files open their owner. When Notion no longer exposes that owner, search still finds the local content and opens a **Local context** dialog with `EntityPanel`, without inventing a Notion task.

External adapters may pass `externalItems?: ExternalSearchItem[]` to `CommandPalette`: `{id,label,kind:'github'|'contact',keywords?,onOpen}`. `onOpen` must show that actual source item. Source details and item queries belong to their adapter phases. Existing `onDraft` and `onLocalEntity` callbacks preserve draft resolution/local context navigation.

Ctrl/Cmd K searches; N captures; R refreshes; arrows or J/K move among visible rows across task sections; Enter opens the focused item; E edits a focused task; X/Space complete or reopen only that unambiguous task; Escape closes dialogs; ? shows help. Inputs/selects/textareas/contenteditable retain normal typing. Modal typing does not trigger workspace shortcuts. Hidden collapsed rows do not intercept movement.

Saved filters already exposed all schema criteria (area, project, tags, priority, start/end, Highlight, completed, Someday), and are preserved.

## Verification boundary

Production contains no synthetic graph/source items. Browser fixtures exist only in test routes, with the browser clock pinned to 2026-10-03 and public timezone Europe/Berlin. HTTP health uses genuine isolated SQLite. Unit/integration tests use genuine SQLite plus mocked upstream adapters. Final Docker QA passed all 62 browser cases in one command, and a configured owned live Notion CRUD/completion/reopen/archive cycle passed; see `DEPLOYMENT.md`. Browser tests use Edge Chromium desktop and iPhone viewport/touch emulation, not actual Safari.

