# TÆSKS implementation and acceptance plan

The complete user specification in `docs/SPECIFICATION.md` is authoritative.

## Execution rules

Agents run strictly sequentially: finish, review, typecheck, integrate, then dispatch the next. Main agent owns cross-module review and final verification. No fixture data in production. No external system schema mutations. Secrets stay server-side. No login.

## Planned agent sequence

1. Architecture / persistence: Next.js App Router + TypeScript, shared contracts, SQLite migrations, local repositories and validated local API.
2. Design / shell: compact monospace interface, mint accent, accessible primitives, responsive navigation, theme, task and entity detail foundations.
3. Notion: official SDK, schema inspection and configurable mappings, pagination, cache, normalized graph, relation-safe CRUD, completion discovery.
4. Parser: deterministic German/English chrono parsing, European dates, aliases, conservative matching, ranges, context, recurrence, interval view logic, unit tests.
5. Core UX: wire Quick Add, drafts, views, task editing, notes, uploads, links, metadata, filters, commands and search.
6. GitHub: Octokit read-only repositories / issues / PRs / reviews / runs / commits, project mappings and explicit task conversion.
7. Contact: server-side PostgREST, read/unread/delete permission errors, list/detail, explicit conversion.
8. Local persistence / notes / attachments: audit the completed local layer, atomic preference patches, real SQLite/file/browser persistence and safe Markdown.
9. Mobile / PWA: responsive polish, manifest, offline readable shell, local capture drafts, reminder delivery.
10. Reliability / security: mutation validation, origin checks, safe uploads and markdown, recurrence idempotency, integration mocks and critical QA.
11. Deployment / final QA: one multi-stage image and container, persistent /app/data, healthcheck, port 2015, README, build/lint/typecheck/tests, runtime and persistence checks.

Phases may be consolidated only where one agent completes all closely coupled responsibilities. No work is dispatched concurrently.

## Architecture contracts

- Core task data belongs to Notion. SQLite stores only extensions, drafts, preferences, notes, files, aliases, mappings, filters and external links.
- Dates are ISO calendar dates in configurable Europe/Berlin. Single parser date means deadline; default start today. Today and seven-day views use inclusive interval overlap.
- Server APIs communicate structured, sanitized errors. Missing credentials are explicit disabled/setup states.
- Completion requires a discovered or selected Notion completion field; ambiguous mappings must be resolved in diagnostics.
- Client parsing uses only the normalized graph, aliases and public timezone config, never credentials.
- External items stay external until explicit task creation with valid area and project.

## Verification and external prerequisites

Track exact test commands and evidence in `docs/VERIFICATION.md`. Do not claim Docker or live integration success without executing it. Node 24 and the Docker Desktop Linux engine are available. Configured Notion/GitHub credentials are present in the existing `.env`; no reference images were supplied. The Contact stack remains separately managed.

The existing `.env` contains configured Notion/GitHub credentials and IDs and was preserved without disclosure. Final actual container adapter reads for Notion/GitHub/Contact succeeded, as did one owned Notion CRUD/completion/reopen/archive cycle. Browser QA explicitly blanked both tokens and Contact auth in Docker and used a harmless local Contact endpoint. No reference images have appeared. Main's independent final review/typecheck and visual checks remain the handoff step.

## Parent review items — reliability fixes completed

All reliability findings below were addressed in phase 10 and verified by 261 passing unit/integration tests plus focused browser evidence; they are retained as the review record, not outstanding implementation work. Phase 11 now verifies the actual Docker runtime and final live adapters.

- [x] PWA: stable local draft UUIDs, acknowledgement-only queue removal, no automatic Notion create, and dismissal reset only on a changed reminder.
- [x] Reliability: generation-bound Notion graph/schema work rejects reuse/publication of pre-invalidation reads; deferred-read regression tests pass.
- [x] Reliability: trash responses verify owned page identity and `in_trash:true`; IDs, timestamps and URLs are normalized and validated.
- [x] Reliability: scoped GET/PATCH requires the requested page ID and configured task data source before normalization.
- [x] Reliability: capture fails closed on replay-marker storage failures and serializes fresh marker checks across open windows while retaining entered input.
- [x] Reliability: Contact's active default and configured-versus-verified health states are reported accurately.
- [x] QA: global GitHub search includes genuinely cached prior contexts/pages. Older unloaded items explicitly require repository pagination or GitHub; no eager all-repository fan-out.
- [x] QA: uncertain draft/external conversion recovery explicitly inspects and links an existing scoped Notion task without another create.
- Deployment: separate persistent Docker QA volume implemented; actual image build, healthy port 2015, non-root UID 1001 and restart/recreation persistence are verified. Development `data/` and its known parent draft remain untouched. Final test/live evidence is tracked in `docs/DEPLOYMENT.md`.

## Reliability and deployment review completed

Notion generation/identity/delete boundaries, fail-closed cross-window capture, GET-only inspected-task recovery with atomic immutable ledgers and startup crash handling, honest Contact health, production CSP, all-cached GitHub palette scope and readable field warnings are implemented. Typecheck/lint/build, 261 unit/integration tests and all 62 browser scenarios passing in one final Docker command are documented in `docs/RELIABILITY.md`, `docs/DEPLOYMENT.md` and `docs/VERIFICATION.md`; failed earlier commands are recorded honestly. The actual Node-24 image is built and the single non-root container runs healthy on port 2015 with persistent `taesks_data`. Restart/recreation persistence, real configured Notion/GitHub/Contact reads and one owned Notion CRUD/completion/reopen/archive cycle passed. `.env` and development data remain unchanged. Main's independent typecheck and final desktop/mobile Light/Dark visual acceptance passed; actual screenshots are saved and the owned UI draft is removed. The running app remains open. Actual Safari/device installation/background notifications and live Contact write permissions remain external verification boundaries.

## Gemini parser migration completed

Optional Gemini fallback now follows deterministic parsing on explicit action only, with a strict server-only Structured Output adapter, independent relation/date/context validation, deadlines and preview confirmation. Obsolete reserved provider variables were replaced in the examples and local environment; existing unrelated values and the permanent Docker volume are preserved. Official `@google/genai` 2.27.0 and its lockfile are installed. Current evidence: 329 unit/integration tests, full 78-case browser regression, 12 final-image parser/health browser checks, typecheck/lint and key-free production/Docker builds pass. The final container is healthy on port 2015. Detailed implementation and verification are in `docs/GEMINI.md`.
