# TÆSKS architecture and module contracts

## Runtime and dependencies

Next.js 16.3 App Router, React 19.3, TypeScript, Tailwind 4, TanStack Query 5. Node 24 is required: SQLite uses `node:sqlite`, without native addons. The stable Drizzle 0.45 SQLite proxy driver is bridged to `DatabaseSync` with positional result rows. This is local, in-process SQL; there is no network database. Server modules import `server-only`; browser code may import only `types.ts`, `schemas.ts`, `public-config.ts`, and `api-client.ts` plus browser modules.

The app runs without credentials and contains no production fixtures. Official Notion SDK 5.27, Octokit 5, chrono-node 2.10, date-fns 4, react-markdown/remark-gfm and Radix accessible dialogs/popovers are installed for subsequent agents.

## Authoritative graph

`src/lib/types.ts` is the shared browser-safe contract. A `Graph` has `areas`, `projects`, `tasks`, `syncedAt`. An Area has `projectIds`; a Project has `areaIds`. A Task has a single `areaId`/`projectId`, `dates: {start,end}`, `completed`, `highlight`, Notion URL and timestamps. Nullable relation IDs represent invalid existing upstream data, not permission to create unassigned normal tasks. CRUD creation uses strict `taskInputSchema` and must validate relation membership against the current graph.

Dates are ISO calendar dates, not timestamps. `publicConfig()` safely exposes only `{timezone,maxUploadBytes,appName}` with default Europe/Berlin. Validate task ranges before writing. A single natural-language date means deadline; context and timezone calculations belong in the parser agent. Metadata is a separate list keyed by `taskId`; no Notion task cores are persisted in SQLite. Core adapters remain to be implemented by subsequent agents.

## Local persistence

`getDatabase()` is a lazy process-global database handle. It opens `${DATA_DIR}/taesks.db` (development default `./data`). WAL, foreign keys and a five-second busy timeout are enabled. Bundled versioned SQL migrations acquire a `BEGIN IMMEDIATE` lock before checking `schema_migrations`, and commit atomically. Filesystem paths and credentials are never serialized in local snapshots.

`repository()` returns the production repository; `createRepository(db)` supports isolated real SQLite integration tests. Available operations:

- `snapshot(): Promise<LocalSnapshot>` contains metadata, notes, public attachment metadata, links, tags, taskTags, aliases, filters, integrations, externalLinks, drafts, preferences and notionMapping.
- `mutate(LocalMutation): Promise<unknown>` validates actions even when called server-side. See `localMutationSchema` for complete discriminated fields.
- `getPreferences()`, `getNotionMapping()`, `getMetadata(taskId)` expose typed records/defaults.
- `getAttachment(id)`, `addAttachment(record)`, `removeAttachment(id)` are private storage helpers; only uploads module should operate physical files.
- `claimRecurrence(taskId)` atomically inserts a unique ledger key and returns true once. `finishRecurrence(taskId,nextTaskId)`, `failRecurrence(taskId)`, `getRecurrence(taskId)` maintain the ledger. Creation already in flight must never be blindly retried, because a remote request may have succeeded before a connection failed. The recurrence agent must address reconciliation.

Entity notes are one Markdown document per `{entityType,entityId}`; upserts preserve IDs and original creation timestamp. Tags are normalized, globally unique and atomically replaced per task. Alias ambiguity is deliberately allowed across different entities; the parser must resolve conservatively. One GitHub mapping is stored per project. One external link is stored per `{source,externalId}`; writing again cannot silently retarget it. The external conversion agent must check existing links before remote creation. Preferences have explicit fields; secrets cannot be persisted through a generic preferences write.

## HTTP and client operations

All routes are Node runtime. GET responses are `Cache-Control: no-store`.

- `GET /api/health` decides success using only app + database `PRAGMA quick_check(1)`. Optional source states are `disabled`, `configured`, or Contact `default` for its enabled built-in endpoint; none claims connectivity. Integration diagnostics provide actual source reachability separately.
- `GET /api/config` returns only public config.
- `GET /api/local` returns `LocalSnapshot` directly.
- `POST /api/local` accepts a `LocalMutation` and returns `{result,snapshot}`. Mutation actions: `saveNote`, `deleteNote`, `addLink`, `deleteLink`, `setTaskMetadata`, `setTaskTags`, `saveFilter`, `deleteFilter`, `saveAlias`, `deleteAlias`, `saveIntegration`, `deleteIntegration`, `setPreferences`, `setNotionMapping`, `saveDraft`, `deleteDraft`, `linkExternal`, `unlinkExternal`.
- `POST /api/attachments`: multipart form fields `file`, `entityType` (`task|project|area`), `entityId`; returns public `Attachment` with 201.
- `GET /api/attachments/:id`: file download with sanitized filename, attachment disposition, no-sniff and sandbox policy.
- `DELETE /api/attachments/:id`: JSON `{confirmed:true}`. UI must request confirmation in a branded dialog first. Returns `{deleted:true}`.

`apiRequest<T>(url,init)` handles structured errors with `ApiClientError`; `localMutation(action)` posts typed actions. Query keys suggested: `["local"]`, `["graph"]`, `["diagnostics"]`, `["github"]`, `["contact"]`. After local writes, set `["local"]` to returned snapshot or invalidate it. External adapter writes must invalidate their own graph/query cache.

`validatedJson(request,zodSchema)` enforces same Origin, JSON Content-Type and streamed 1 MB limit before parsing. `assertSameOrigin` requires Origin equal to `APP_ORIGIN` (if configured), otherwise the request protocol plus its HTTP Host. Next may construct its internal URL using the bind address, so comparing only that URL would reject valid browser requests. Forwarded Host is never trusted; `Sec-Fetch-Site:cross-site` is denied. Configure APP_ORIGIN to the externally visible origin behind a reverse proxy. Read-only routes do not require Origin. `AppError(code,message,status,details)` produces user-safe errors; unknown exceptions are logged with source/operation/correlation ID/type, never raw credential-bearing error data. Client error shape is `{error:{code,message,correlationId,details?}}`.

## Upload boundaries

Uploads are streamed to a bounded request buffer before multipart parsing and individually capped at 20 MB. Stored filenames are generated UUIDs with no user path component. Supported declared MIME types are PNG/JPEG/GIF/WebP/PDF, UTF-8 plaintext/Markdown/CSV/JSON, ZIP/Office zipped documents, and generic octet-stream downloads. Known image/document MIME signatures are checked. Active HTML/SVG MIME types are rejected. User display filenames are sanitized; downloads always use attachment disposition and no-sniff. Metadata omits storage names. Writes remove the physical file if the database insert fails. Deletes quarantine the physical file, delete metadata, restore on database failure, then remove quarantine.

Markdown rendering must use `react-markdown` + `remark-gfm` without raw HTML plugins or `dangerouslySetInnerHTML`; external links must use the HTTP/HTTPS URL validation schema. Contact messages are plain escaped text.

## Validation

`npm run typecheck`, `npm run lint`, `npm test` use TypeScript, ESLint and Vitest. Tests use genuine in-memory/temp-file SQLite, including reopen persistence, migration idempotency, tag rollback, recurrence/external-link idempotency and request/file safety. `npm run test:e2e` uses Playwright with desktop + mobile Chromium and a dev server (or external `E2E_BASE_URL`); the initial health happy path is implemented. Subsequent agents add UI and adapter-specific coverage. `npm run build` emits standalone server assets for the Docker stage.

Primary references used: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Drizzle SQLite proxy](https://orm.drizzle.team/docs/sqlite-proxy). The actual installed stable Drizzle package was inspected to verify the supported adapter, rather than relying on docs for an unreleased driver.
