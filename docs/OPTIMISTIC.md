# Mutation audit and interaction contract

Audit performed before implementation, 2026-10-04. All task views, search and their counts derive from one `graph` and one `local` query. Contact has independent filtered/paginated queries. No route refresh is needed for writes.

A = immediate optimistic result. B = immediate presence/intent with an explicit pending or unsaved state. C = confirmation required.

| Mutation / source | Before | Target | Failure / rollback | Cache and counts | Ordering risk |
|---|---|---|---|---|---|
| Complete / reopen, Notion | Await write, replace task, invalidate graph; workspace-wide guard | A: change completion immediately | Restore affected task in original array position; retain newer intents | graph; every view, search, area/project/tag/filter/today count | Same task completion, reopen and edits |
| Create, Notion (quick add, draft, Contact, GitHub) | Await create with blocked composer | B: UUID temporary task, immediate composer result | Remove temporary task; preserve capture/draft and uncertainty guard | graph + metadata/tags/source link in local; all matching counts | Temp edit/delete, duplicate conversion, uncertain POST |
| Title / dates / highlight / area / project, Notion | Await Save, disable entire inspector | A after validated Save; inspector remains editable | Drop failed intent; preserve entered form text for correction | graph; membership, ordering, counts, search | A→B→C, move with invalid relation, older reads |
| Confirmed task trash, Notion | Await archive then close | A after confirmation | Restore exact task; global error survives closed inspector | graph; all derived counts | Delete during create/edit |
| Priority / recurrence / reminder / someday, SQLite | Sequential awaited scheduling save | A; metadata patch before request | Drop affected patch only | local metadata; all selectors, reminders, counts | Same task metadata vs other fields |
| Task tags, SQLite | Await save | A | Restore affected assignment only | local tags/taskTags; tags/search/counts | Concurrent tag catalog creation |
| Contact read / unread, PostgREST | Await write, invalidate counts, await all active reads | A: patch every cached filter and unread count | Restore row, position and counts without refetch | all Contact pages; global unread/inbox/search | Read→unread, pages with same row |
| Confirmed Contact delete, PostgREST | Await delete and re-reads | A after confirmation | Restore affected row and count deltas | all Contact queries and counts | Delete vs read, off-page rows |
| Notes edit, SQLite | Await Save then dismiss editor | B: immediate controlled text, debounced persistence | Retain unsaved text and Retry, including after closing/reopening | local notes; note previews/search | Typing during a previous save, unmount |
| Confirmed note delete, SQLite | Await before confirmation closes | A | Restore affected note only | local notes/search | Pending note save vs delete |
| Link add / confirmed remove, SQLite | Await response | A; temporary link then confirmed ID | Restore link / retain add form | local links and link counts | Delete newly added temporary link |
| File upload, filesystem + SQLite | Invisible until response; one global upload guard | B: queued/uploading/failed row immediately; ready only after bytes confirmed | Keep failed row with Retry/Remove | local attachments and attachment counts | Upload vs panel unmount/temp task/delete |
| Confirmed file delete, filesystem + SQLite | Await then invalidate local | A after confirmation | Restore attachment in original position | local attachments/counts | Delete vs other uploads |
| Saved filter create / rename / confirmed delete, SQLite | Await response | A | Restore affected filter only; keep entered form | local filters; sidebar/filter view | Same filter edits/deletion |
| Alias create / edit / confirmed delete, SQLite | Await response | A | Restore affected alias only | local aliases; parser | Same alias identity |
| Project↔GitHub mapping / remove, SQLite | Await response, old selector remains | A; GitHub reads follow new context | Restore affected project mapping | local integrations; project GitHub context | Mapping A→B→C |
| Theme / sidebar collapsed / last view, SQLite | Await preference cache; view itself immediate | B: session state immediate; failed persistence marked unsaved | Keep session preference and Retry | local preferences | Independent preference keys |
| Sidebar group expansion, selection, sort/filter controls | Already component state | A, keep local | Not applicable | component state | None |
| Save/delete device draft | Durable device entry first; composer may await sync | B: close after durable save, sync in background | Retain acknowledged/unacknowledged device entry | device drafts + local drafts/inbox count | Existing cross-tab revision/lock |
| Local external link/unlink | Await local write | A for validated link intent | Restore affected source link | local externalLinks/inbox | Conversion identity |
| Recurring completion: original | Await entire service operation | A for original; C for next instance | Original rollback on completion failure; next instance only inserted when confirmed | graph + next task metadata/tags | Existing atomic recurrence ledger retained |
| Notion property mapping validation / schema refresh | Server validation before apply | C: selection immediate, verified schema/capability after response | Keep form, report validation failure | local notionMapping/schema/graph | Must not claim an unverified completion mapping |
| Verify/link an existing unconfirmed create | Explicit inspection and remote verification | C | Keep capture and uncertainty markers | graph/local after verification | Never automatically replay an uncertain create |
| Gemini interpretation | Explicit cancellable request then preview | C | Keep deterministic/manual editor | composer preview only | Existing abort/revision guard |
| Browser installation / notification permission | Browser confirmation | C | Actual browser result | browser state | External permission authority |
| GitHub lists, Contact reads, refresh, health | Read-only loading | C / normal reads | Retain last read data | source queries | Cancel/ignore reads started before a write |

Implementation contract: TanStack Query owns rendered data. Central ordered intent patches retain the confirmed affected cache entries, replay later intents after a failure, and reconcile only the affected entities. Same entity writes are serialized; unrelated entities run in parallel. Reads consume cancellation signals and carry a cache revision. Errors are announced globally even when the initiating row/dialog disappears. Normal writes do not invalidate the whole app. Temporary IDs are resolved before dependent requests and carry stable rendering keys. Offline edits remain explicitly unsynced with retry; creates retain the existing durable draft and uncertain-create safeguards.

## Completed implementation

The previously awaited Notion, Contact and SQLite actions now update their visible query data in `onMutate`, before their requests start. The inspector remains editable, confirmed deletion closes immediately, and completion immediately changes view membership. Quick Add, acknowledged draft conversion and Contact/GitHub conversion insert the expected task immediately. Existing confirmation dialogs, validation, source ledgers, uncertain-create guards, Gemini behavior and read-only GitHub access remain intact. Link editing was added to the existing local link model and uses the same URL validation and optimistic strategy as add/remove.

`src/lib/optimistic.ts` is the shared mutation coordinator. TanStack Query remains the rendered-data owner. The coordinator retains immutable confirmed affected cache entries and ordered intent patches. Removing a failed intent and replaying later intents restores the original row position, section, membership and counts without reverting unrelated or newer edits. Normal task/local writes reconcile only the affected record or table slice; they do not apply a whole response snapshot or invalidate every query. Errors remain available after the originating row or dialog disappears.

Task selectors, search, sidebar and Area/Project/Tag/Saved Filter counts derive from the same patched graph/local entries. Contact updates every cached filtered page and canonical detail, including off-page count deltas. If a new page opens during a write and its server counts could already include that write, only its ambiguous counts are silently verified after success; the existing caches retain their immediate counts. Failed source refreshes retain the existing readable data.

Writes to one entity run in order; other entities remain independently usable. A newer optimistic C edit is replayed over a confirmed B response and is never replaced by it. Read cancellation, revisions, confirmed task versions and offline-response markers prevent older reads from erasing pending or acknowledged intent. A genuinely newer verified server version can still become authoritative. Retry cannot replay an older rolled-back edit over newer work.

Creates use collision-safe `temp:${crypto.randomUUID()}` IDs and stable `clientKey` row keys. Success assigns the real ID and resolves dependent requests, metadata and device text drafts. Editing a temporary task waits for its real ID; deleting it immediately removes its row and archives the eventual confirmed task. No second create request is used to resolve identity. Uncertain remote create outcomes remain guarded for explicit inspection rather than automatic replay. Recurring completion immediately completes the original; its next instance appears only after the server confirms the existing atomic recurrence operation.

Notes retain the user's latest text as unsaved on persistence failure, with Retry and a durable device copy. Core editor text is also retained across closing/reopening/reload; acknowledged field normalization preserves any later edits. Uploads have immediate presence with queued/uploading/failed states and retained bytes for Retry/Remove, but a download is exposed only after confirmation. Confirmed file deletion is optimistic and restores the original attachment on failure. Preference failures retain the session choice and show unsaved status.

Offline ordinary edits remain visibly unsynced in the current app session and have explicit ordered Retry after reconnect. Pending changes trigger a leave-page warning. This is not a new persistent offline replay engine: ordinary mutation closures and file bytes do not survive page termination. Device drafts, note text, core editor text and existing uncertain-create guards are durable. Remote task creation is never automatically retried during reconnect.

Confirmation-dependent exceptions are Notion schema/property validation, inspected uncertain-create reconciliation, AI interpretation, browser permissions/installation, the actual uploaded file and the next recurring task. Their input/preview/presence can react immediately, but the UI does not claim an unverified external outcome. GitHub reads and explicit source refreshes keep normal read loading behavior.

## Verification

The dedicated coordinator tests cover immediate results, exact rollback, independent entities, ordered rapid edits, stale reads, genuinely newer server versions, temporary identity/edit/delete, source/metadata cleanup, text preservation, offline ordered retry, Contact filter/count consistency and scoped local writes. Notion failure cases explicitly include 401, 403, 404, 409, 429, 500, timeout and network rejection. Device editor and repository tests cover newer text preservation and safe link editing.

The browser suite checks actual rendered behavior before delayed responses resolve, including 500ms, 1500ms and 3000ms delays. Central 3000ms cases cover complete, create, edit, move, delete, highlight, tags, Contact read/delete, saved filters and attachment deletion. It also verifies temporary task edit/delete, failure after closing, upload failure and retained-byte retry, note unsaved reopening, offline completion/retry and B→C edits. Real SQLite/file, PWA and existing Gemini/source coverage is retained. Screenshots cover desktop/mobile, light/dark and the existing responsive target sizes. Upstream error/delay responses are controlled fixtures; private production tasks and messages are not mutated by these tests.

Final results, 2026-10-04 Europe/Berlin:

| Check | Result |
|---|---|
| TypeScript / lint | Passed |
| Unit/integration | 363 tests in 22 files passed; 34 added cases |
| Production Next build | Passed |
| Full browser suite | 116/116 passed, one complete command, 5.1 minutes; 38 new delayed optimistic cases across desktop/mobile |
| Browser command | `E2E_BASE_URL=http://localhost:3025`, `PLAYWRIGHT_CHANNEL=msedge`, `npm run test:e2e -- --workers=4` |
| Docker build | Passed; final tested image `sha256:2bc8bffa6a6ec278cc45429a0f02ab06591fdbd75c06d009b009e969a1180a81` |
| Deployment | Exact tested image tagged `taesks:local`; `docker compose up -d --no-build --force-recreate --wait --wait-timeout 60` passed |
| Container | `taesks` healthy; UID/GID `1001:1001`; port `2015→3000`; original permanent `taesks_data:/app/data` retained |
| Post-deployment source read | Notion diagnostics ok; 12 Areas, 19 Projects, 60 Tasks, matching pre-deployment totals; health ok |

The full browser command ran against an isolated production QA container without the permanent volume or integration credentials. Real SQLite and file cases used that container; controlled upstream fixtures simulated success/failure/latency. Configured production integration access after deployment was verified read-only, without creating, changing or deleting existing external data. Browser coverage uses installed Edge Chromium and mobile touch/viewport emulation; actual Safari/iOS and OS notification delivery are not established by this run.
