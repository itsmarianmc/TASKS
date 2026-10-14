# UI copy audit

Scope: all files in `src/` and `public/`, including React views, shared dialogs, browser notifications, PWA metadata, parser validation, query status messages, server errors and diagnostics. Tests and styles were reviewed for text dependencies and spacing. No functionality, parsing rules, navigation targets, data sources or persistence behavior is changed.

## Decisions recorded before implementation

| Surface | Decision | Reason |
| --- | --- | --- |
| Command palette | REMOVE search description and permanent GitHub search implementation message; REMOVE repeated row types; SHORTEN navigation to destination names; REWRITE `list` / `source` as one navigation group | Title, input and group headings already explain the interaction |
| Search warnings | KEEP unavailable/stale results and truncated-results guidance, SHORTEN | Results may be incomplete; the user needs an action |
| Sidebar, breadcrumbs | KEEP labels, counts, shortcuts and accessibility names; REMOVE structural eyebrow text repeating the breadcrumb | Navigation needs names, not explanations of its structure |
| Task lists, Inbox, Today, Someday | KEEP counts, dates, sync status and empty-state titles; KEEP `Ideas for another day will be waiting here.`; REMOVE repeated capture instructions and draft section subtitle | Empty-state meaning is useful; the add button explains capture |
| Projects, areas, notes, links, files | KEEP actual project status, dates, notes and source descriptions; REMOVE persistence explanation and redundant note-editor feature list | Actual content is not product help text |
| Quick add | REMOVE natural-language tutorial and confidence percentage; SHORTEN placeholder and keyboard hints; KEEP detected fields, ambiguity messages and manual confirmation | Values and editable fields explain the behavior |
| Capture recovery | SHORTEN warnings and recovery instructions; KEEP uncertain-create warnings, inspected-task confirmation, known task ID and discard consequences | Avoiding duplicate creation and data loss matters |
| Task inspector | REMOVE technical subtitle; SHORTEN save labels and notices; KEEP separate task and scheduling saves, partial-success notices, reminder timezone and Notion trash consequence | Separate save operations must remain clear |
| GitHub | REMOVE token/scope and activity-loading explanation; MOVE setup details to Diagnostics; KEEP one read-only account status, repository metadata, pagination and failure guidance | Normal views need actions and activity, not transport details |
| Contact | SHORTEN status notices and pagination; KEEP read state, sender, site, received time, message identity, filter semantics and irreversible deletion | User data and confirmation are actionable |
| Settings & diagnostics | REMOVE general introduction and duplicate disabled-AI prose; SHORTEN status and setup copy; KEEP credentials setup, property mappings, completion safety, permissions and browser constraints | Technical details belong here, with concise wording |
| PWA and notifications | SHORTEN offline banner, queued-draft status and settings explanations; KEEP cached timestamp, connection constraints, reminder delivery limits and permission guidance | Offline and notification limitations affect decisions |
| Error paths and validation | KEEP meaningful causes, retry guidance, partial success, security warnings and destructive confirmations; SHORTEN excessive wording | Errors need a problem and a next step |
| Shared dialogs | REMOVE decorative confirmation slogan; render optional descriptions only when present; KEEP accessible titles and close labels | Removed descriptions must leave no empty container or inaccessible dialog |
| App metadata | REWRITE marketing description to a neutral product description | Product voice also applies to installation metadata |

Non-UI strings (API identifiers, database fields, class names, logging, routes, fixture content) stay unchanged. Technical information in error details remains available. User-authored data is not rewritten.

## Copy rules

- Sentence case; no punctuation on labels unless it belongs to a name or shortcut.
- Name the action or destination directly. Avoid descriptions repeating the label.
- Keep counts, dates, sync and connection status, offline constraints and meaningful empty states.
- Technical setup and persistence information belongs in Settings & diagnostics; error details may be technical when needed to fix the problem.
- Preserve ambiguity, validation, unconfirmed writes and destructive consequences. Do not replace a specific failure with a generic success or error.
- Keep icon-button accessibility labels. Dialog descriptions are optional; omitted descriptions render no container and no dangling accessibility reference.
- Use character sparingly. Keep `Ideas for another day will be waiting here.` unchanged.

## Implementation accounting

22 visible copy blocks removed and 87 shortened, counted once per literal or dynamic copy template rather than once per rendered row. This includes shared labels used in several views. Reworded labels, moved setup information and layout-only changes are separate.

| Location | Removed | Shortened |
| --- | ---: | ---: |
| Palette and search status | 3 | 4 |
| Workspace, views and shortcuts | 8 | 11 |
| Quick add | 3 | 19 |
| Task inspector | 1 | 11 |
| Notes, links and attachments | 2 | 1 |
| Contact UI and status helpers | 0 | 11 |
| GitHub UI | 1 | 5 |
| Settings and mappings | 3 | 10 |
| Shared confirmation | 1 | 1 |
| PWA | 0 | 7 |
| Request, parser and field errors | 0 | 7 |
| Total | 22 | 87 |

Removed copy includes the palette description and GitHub search implementation sentence, repeated result types, four structural eyebrow templates, editor feature list, attachment persistence note, Quick Add tutorial and confidence percentage, routine success task ID, task-inspector subtitle, redundant capture/draft instructions, settings introductions, duplicate AI explanation and confirmation slogan.

GitHub token setup and read permissions moved from its working view into the expandable `Set up GitHub` diagnostics section. Notes and file persistence was already documented in Notion setup in diagnostics, so no duplicate explanation was added.

Layouts adjusted: palette heading/input spacing, result row label width and result-list height; shared dialogs without descriptions; note editor save alignment; project/area/source/settings headings. Empty descriptions and empty repository-description paragraphs are not rendered.

Updated existing tests: `core.test.ts`, `contact.test.ts`, `github-cache.test.ts`, E2E `core.spec.ts`, `design.spec.ts`, `local.spec.ts`, `pwa.spec.ts`, and the live screenshot helper. Added E2E `microcopy.spec.ts` for palette groups/spacing/accessibility, missing-field validation, useful empty states, destructive cancellation, diagnostics placement and screenshots. Corrected the screenshot fixture's empty Contact count without changing application behavior.

## Validation

Completed on 2026-10-04:

- TypeScript: passed.
- ESLint: passed.
- Unit tests: 266 passed across 18 files.
- E2E: 70 passed against the production container, including desktop, mobile, real local persistence, file download, deliberate deletion, failed writes, PWA offline reads, durable draft sync, cross-window capture and notification permission behavior.
- Production build: passed locally and in Docker.
- Docker Compose build: passed. Existing container updated with its data volume preserved; health check reports `healthy`.
- Visual QA: 30 new dark-mode screenshots from test-scoped fixtures. Covers the palette, Inbox, empty and populated projects, area, Today, empty and populated Someday, unresolved Quick Add, GitHub and repository activity, Contact and message detail, empty Contact and Settings & diagnostics on desktop and mobile. Existing responsive design screenshots also cover both themes and widths from 390 to 2560 pixels.
- Reviewed desktop and mobile screenshots for spacing, useful empty states, text wrapping, missing containers and technical working-view explanations. No horizontal overflow in the screenshot checks.

Screenshots are produced in `test-results/copy-screenshots`; the screenshot gallery and complete literal inventory are also preserved as a separate Codex visualization artifact. The inventory includes implementation identifiers as well as UI text so helper-generated errors and statuses are not omitted.

No tests were deleted. Old copy expectations were updated, and the new mobile screenshot test waits for the refreshed project list before opening the palette after reload.
