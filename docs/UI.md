# TÆSKS interface and client contracts

## Visual system

The interface uses the local Cascadia/SFMono/Consolas/Liberation Mono stack; no font downloads. Mint marks actions and the active navigation rail. Red indicates errors, amber dates/highlights, blue links and purple GitHub context. Theme variables in `src/app/globals.css` cover complete light/dark palettes. `ThemeSync` follows the OS in system mode and listens for changes. SQLite preferences persist theme, current view and sidebar collapse.

Desktop has a dense 234px sidebar, breadcrumb header, list content and an optional right-hand task dialog. Mobile uses a Radix Lists drawer and hierarchical back navigation (project → its single area → overview). There is a small floating capture button and no bottom tab bar. Dialogs trap focus, close on Escape and restore focus through Radix. Destructive local actions require the branded `ConfirmDialog`; failures remain inside the dialog. Native buttons, headings, labels and focus rings preserve accessibility. Reduced-motion preferences suppress animation.

## Components

- `AppShell` loads local storage, then `Workspace` composes independent navigation, views, dialogs and details.
- `Navigation` receives the graph/local snapshot and a `ViewId`, derives counts from the same view selector used for main content, and supports collapsed areas/sections. No production fixtures.
- `TaskRow` is callback-driven. `onOpen`, `onComplete`, `completionEnabled` and `pending` support the forthcoming core mutations. Until a real completion callback is supplied the checkbox is disabled. Main shell intentionally supplies no completion operation in this phase.
- `TaskDetail` displays Notion fields and wires local priority, Someday, tags and `EntityPanel`. Core Task UX must add validated title/relation/date/highlight/completion/delete/recurrence/reminder operations here.
- `EntityPanel` wires Markdown note save/edit/delete, link add/delete, file upload/download/delete for task/project/area. Call sites key it by `${entity.type}:${entity.id}` to isolate unsaved editor values. ReactMarkdown + GFM render without raw HTML plugins. Links use safe server validation, new tabs use `noopener noreferrer`.
- `Capture` saves a genuine local Inbox draft, conservatively carrying only a current project/area context. It explicitly labels the action `Save draft`; it does not claim to create a Notion task or parse dates. Unsaved input is retained in browser storage, failures leave the input available. Mount it only when open so browser draft restoration occurs immediately. Parser/Core UX will replace its preview/submit with deterministic parsing, resolution and task creation while retaining this safe draft path.
- `CommandPalette` combines commands and actual graph/local search results. Ctrl/Cmd K opens it; N opens capture; ? opens help outside inputs. Arrow keys move focus inside lists; native Enter activates rows. Text inputs/textarea/select/contenteditable keep normal typing.
- `SettingsView` includes appearance, real health status, Notion property mappings, alias add/edit/delete, saved filter add/edit/delete and repository mapping upsert/delete. Entity selectors disable when graph data is unavailable. A configured service is never presented as verified connectivity solely because its credentials exist.

## Data/query contracts

`src/lib/queries.ts` exposes `useLocal`, `useLocalMutation`, `useConfig`, `useGraph`, `useRefresh` and `queryKeys`. Local mutations set the canonical `["local"]` snapshot only after server success; there is no speculative success or unsafe optimistic rollback.

The next Notion adapter must implement:

```ts
GET /api/graph
GET /api/graph?refresh=1 // manual refresh bypasses the server integration cache
// Response:
{ graph: Graph, diagnostics: Diagnostic[], completionEnabled?: boolean }
```

No server route is invented or faked in this phase. Missing graph route/source presents setup content while local operations remain functional. Failed refresh preserves previously loaded graph content with an explicit failure notice. `useRefresh` fetches `?refresh=1` into the existing graph key and invalidates local, diagnostics, GitHub and Contact query keys. Integration agents should extend force-refresh semantics for their own upstream caches. Settings' current Check Connections requests health and invalidates graph; the Notion diagnostics phase should supply actual schema/connection results and force-refresh there too.

`ViewId` is `inbox|overview|today|next|upcoming|anytime|someday|settings|github|contact` or `area:<id>|project:<id>|tag:<id>|filter:<id>`. `src/lib/views.ts` is a browser-safe initial date/filter selector. The Parser/Core UX phase should consolidate it with the fully tested interval rules (including future intervals whose start is missing), sorting, completed sections and search. Navigation and main lists both use `tasksForView`; preserve a single selector so counts cannot drift.

External source view content currently explains configuration and links to Diagnostics. GitHub/Contact agents must replace it with actual adapters/results and independent errors. No fixture source items are shown.

## Verification

Executed TypeScript, lint, all 13 foundation tests and optimized production build successfully on 2026-10-03. The parent agent will perform browser visual/interaction checks before the next sequential integration phase. Local APIs, validation and attachment safety retain the foundation's real SQLite tests. No live Notion/GitHub validation is claimed without credentials.
