# Local context, persistence and files

Notion owns task titles, relations, dates, Highlight and completion. The local database stores supplementary context only; no local mutation can write or manufacture a Notion task core. Notes, links and attachments can belong to a task, project or area, including an entity temporarily absent from the current Notion graph. Search opens that entity's **Local context** dialog so an upstream outage or removed relation cannot erase the saved context.

## Storage and concurrency

Node 24's `node:sqlite` driver opens `${DATA_DIR}/taesks.db`. Development defaults to `./data`; the deployment uses `/app/data`. Drizzle's SQLite proxy maps typed queries onto that in-process driver. There is no separate database service. Versioned migrations run in a synchronous `BEGIN IMMEDIATE` transaction with WAL, foreign keys and a five-second busy timeout. Reopening preserves data and does not rerun applied migrations.

The repository stores notes, links, private file metadata, task metadata, tags/task assignments, saved filters, parser aliases, project repository mappings, stable external links, Inbox drafts, explicit application preferences and Notion field mappings. Conversion/recurrence ledgers persist confirmed IDs and uncertainty independently of task cores. Secrets are not accepted by generic local actions and storage filenames are omitted from public snapshots.

Preferences merge only the supplied fields under a single synchronous SQLite write lock. Concurrent theme, sidebar, navigation and notification-setting changes therefore preserve each other. Tag replacement is similarly transactional: a rejected insert restores the original task's tags. Notes are unique per entity and updates preserve their ID and creation timestamp. Independent task metadata patches update only their changed columns on conflict.

`GET /api/local` returns the canonical local snapshot. `POST /api/local` validates a discriminated mutation, same origin, JSON content type and a bounded request body; its successful response includes the saved result and canonical snapshot. Local content operations do not require a working Notion, GitHub or Contact connection. Integration repository validation is the intentional exception when a GitHub token is configured.

## Notes and links

The compact entity panel edits one Markdown document per entity, up to 500,000 characters. `react-markdown` and `remark-gfm` render headings, ordered/unordered lists, fenced code, inline code, emphasis, tables, strikethrough, task lists and ordinary links. Raw HTML is skipped; no raw-HTML plugin or HTML injection API is used. Markdown links become clickable only for valid HTTP/HTTPS URLs without credentials and open with `noopener noreferrer`. Invalid or active-protocol links retain their label as plain text. Malformed URL strings return validation failures instead of throwing during rendering or request validation.

Separate saved links use the same HTTP/HTTPS boundary. Their short label and file rows remain compact; attachments are not displayed as large cards. Note and link save failures keep the editor and entered values available. Deletes use the application's confirmation dialog, and cancelling preserves the item.

## Attachments

Multipart uploads accept exactly one file and an entity reference, with a 20 MB file cap and bounded multipart overhead. Physical content lives under `${DATA_DIR}/uploads` with generated UUID filenames, never a user-supplied path. Display filenames are sanitized separately. Declared PNG, JPEG, GIF, WebP, PDF and ZIP/Office archive types require matching signatures; UTF-8 text/Markdown/CSV/JSON are validated as text. Active HTML/SVG types are rejected. Unknown binary files use `application/octet-stream` and remain downloads.

An upload opens its own UUID file exclusively with mode `0600`, writes and closes it, then inserts metadata. A partial write, close failure or metadata failure removes that request's file. A pre-existing filename is never deleted because exclusive open happens before the cleanup scope. The file is not advertised until the write and metadata insert succeed.

Downloads resolve only server-held UUID storage names. They use `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, no-store and a sandbox content policy, including images and PDFs. The endpoint returns an honest not-found/unavailable error when metadata or bytes are missing.

Deletion first moves the file to a unique quarantine name, removes database metadata, and then unlinks quarantine. A database failure restores the original file so it remains downloadable. If physical content is already missing, confirmed deletion can remove stale metadata. A final quarantine-unlink failure is logged without secrets; it does not falsely report that a successfully deleted metadata row still exists. Backup and crash recovery must preserve database plus uploads together; the final deployment guide documents volume backup procedures.

## Verification boundaries

Repository and local HTTP tests use real temporary/in-memory SQLite; file tests use actual private temporary files, actual multipart route handlers and checksum comparisons. Failure injection covers partial physical writes, rejected metadata inserts/deletes and missing files. No remote task or Contact write is involved.

`tests/e2e/local.spec.ts` uses real `/api/local` and `/api/attachments` against a separately managed server and isolated `DATA_DIR`. Only Notion graph, GitHub, Contact and public config responses are browser test fixtures. It creates unique owned local entities and removes only those test records. Desktop and mobile Chromium checks cover Markdown rendering/safe links, retained failed-save input, upload/download checksum, delete cancellation/confirmation, reload persistence, Notion read diagnostics, aliases and saved-filter criteria. Browser error and React render-depth checks remain active. An idle-source check guards bounded query reads; cached Contact search subscribers react only to successful published data or removed queries.

Offline capture and reminder delivery are separate modules; this local layer does not claim background/offline external writes. Final actual Docker-volume draft/note/file-checksum persistence passed restart and force-recreation; see `DEPLOYMENT.md`.

## Immediate local interactions

The central TanStack intent layer patches SQLite-backed rows before awaiting persistence. Note text is controlled locally, backed by a device copy, and saved after 500 ms idle or explicit Save; failures retain unsaved content and Retry. Link add/edit/delete, aliases, filters, task metadata/tags and repository mappings reconcile only affected records. Theme/navigation preferences may remain unsaved for the session. File uploads appear immediately as uploading/queued/failed and offer Retry/Remove; a download is exposed only after an actual upload response. Confirmed deletions hide immediately and restore on failure. No ordinary mutation invalidates the entire local snapshot.
