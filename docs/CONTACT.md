# Contact Inbox

Contact submissions remain external inputs. Opening, searching, filtering or marking them does not create a Notion task. The Contact stack remains separately managed; TÆSKS adds no Postgres service, shared Docker network, browser CORS workaround or upstream configuration changes.

## Server configuration

`CONTACT_API_BASE_URL` defaults to `http://192.168.2.173:1917`. It must be an HTTP(S) base URL without credentials, query or fragment. A base path is supported; the adapter appends `/contact_submissions`. Restart after environment changes. The server alone contacts this address; browser requests use the app's `/api/contact` routes.

`CONTACT_API_AUTH_HEADER` is optional. Leave it empty for the existing anonymous endpoint, or supply **one complete header** as `Authorization: Bearer YOUR_TOKEN` (or a custom authentication header such as `X-API-Key: YOUR_TOKEN`). This is a header name, colon and value, not a JSON object or token alone. In Compose or dotenv, quote a value when its parser requires it. Newlines and routing/browser/cookie/content-negotiation headers are rejected. Authentication values are never returned to the browser, persisted in SQLite or included in logs. Independently secure the existing PostgREST service and its database role/row policies; TÆSKS does not change them.

The expected record has integer positive safe-number `id`, strings `site_origin`, `name`, `email`, `message`, an ISO timestamp `created_at`, and boolean `is_read`. Invalid successful bodies become a source error, never a fabricated empty inbox. Messages are escaped plain text throughout the interface. Only valid HTTP(S) site links without credentials and validated, encoded mailto links become clickable. A bare hostname remains text. No email is sent.

## Reads, counts and caching

`GET /api/contact?filter=all|read|unread&sort=newest|oldest&page=N&site=EXACT_ORIGIN&search=TEXT&refresh=1` validates all parameters, rejects unknown ones, and reads 50 rows per page. Ordering uses `created_at` and `id` in the same direction for deterministic ties. Site filtering uses exact equality. Search uses case-insensitive substring matching over name, email, message and site origin. Search/site values are quoted and escaped inside PostgREST's filter grammar, separately from URL encoding; quotes, commas, parentheses and backslashes cannot introduce another condition. Percent/underscore SQL wildcards are escaped. PostgREST's standard `*` LIKE alias remains a wildcard.

The adapter sends `Prefer: count=exact` and validates a numeric `Content-Range` total. Missing, malformed or unknown counts are errors, never zero. Global unread count is an independent `select=id&is_read=eq.false&limit=0` read, unaffected by current list/site/search filters. Counts describe rows visible to the configured PostgREST role and its policies. A count-only permission failure preserves valid messages, reports the separate failure and retains any previous count with an explicit warning; absent counts display as unknown. The Inbox previews the newest unread page and provides navigation to all messages and pagination.

Server cache lifetime is 60 seconds, with at most 100 list/filter/page entries and concurrent-read deduplication. Upstream requests have a 15-second deadline, reject redirects and stream into an 8 MB response bound. A later failed read retains actual cached messages and their original successful read timestamp, with sanitized diagnostics and correlation ID. Manual/global refresh sends `refresh=1` for every active Contact query, including current filters/pages, unread summary and an open palette search. HTTP 200 responses carrying source error diagnostics make the overall refresh announcement report partial failure; disabled optional integrations remain normal.

The palette searches every genuinely loaded Contact page and additionally requests debounced server search after two characters. This finds older messages without eagerly loading the whole table. Loading/errors and a 50-result truncation notice remain visible. Search results open the actual source record; there are no production fixtures.

## Optimistic mutations, confirmed upstream writes

`PATCH /api/contact/:id` accepts only `{is_read:true|false}`. `DELETE /api/contact/:id` requires the branded confirmation dialog and `{confirmed:true}`. Both use the app's same-origin/JSON/size boundary. The server sends the exact ID equality filter and `Prefer: return=representation`. Success requires exactly one valid returned row with the expected ID; PATCH also requires the requested boolean. Denials, empty arrays from row policies, 204/no representation, malformed or mismatched rows, and timeouts never become UI success. An uncertain result explicitly asks the user to refresh and inspect before retrying.

Before the write, all loaded browser filters/pages and the selected detail are patched with the read/delete intent. Known list and global unread counts change by the affected row’s delta; unknown counts remain unknown. Same-message requests are serialized. Rejected or unconfirmed writes restore rows, original positions and count deltas immediately, with brief global feedback. Success reconciles only the affected message and does not await re-reads. Cancelled/pre-write reads and retained error copies cannot undo current intent. Server generation boundaries continue to expire pre-mutation reads. The server still verifies the actual affected row before declaring persistence successful.

Desktop uses a compact list beside detail; mobile opens the detail with a messages-back action. Selecting a submission alone never marks it read. Read/unread and deletion are deliberate actions. The shared Inbox combines unread Contact messages, actionable GitHub context and local drafts; Navigation/Overview reflect the verified unread count. Settings displays actual read/count diagnostics, while write permissions are verified only by their own confirmed operation.

## Explicit task conversion

Create task opens the existing `TaskComposer` with source `contact`, stable external ID `String(submission.id)` and source URL `null`. The separate site link is a website, not a fabricated PostgREST browser link. The first nonempty message line is preserved verbatim as the title (up to the task title's 2,000-character limit); name/ID are deterministic fallbacks. Numbers, date words and `#` punctuation are not consumed by natural parsing. Project/Area require normal manual, compatible assignment. Creation occurs only after user confirmation through the Notion task service and its durable external conversion ledger. A confirmed local link changes the action to Open linked task. Composer warnings/confirmed IDs remain visible until Done. Without a Notion graph/credentials, Save draft still persists the source and title locally without creating a fake task.

## Verification boundary

Adapter/route tests use injected transports and cover actual request shapes, exact counts, quoted filter grammar, pagination, cache force/deduplication, generation races, denied/zero-affected writes, malformed successful bodies, stale timestamps, redaction and request validation. Browser fixtures cover desktop/mobile list/detail, escaped script text, safe links, mutation failures/confirmation/cancel, explicit task conversion/linkage, source-preserving drafts without Notion, Inbox, page/global server search and forced reads. All fixture data is confined to tests.

Live verification was read-only: expected endpoint/schema, exact count responses and a zero-result quoted OR search were accepted by the existing PostgREST stack. No private message text was logged and no live Contact read-status/deletion or Notion write was performed. Fine-grained database write/row-policy success remains dependent on the separately configured live role.

Primary protocol references: [PostgREST tables, filters and mutations](https://docs.postgrest.org/en/stable/references/api/tables_views.html), [URL grammar and quoted values](https://postgrest.org/en/v12/references/api/url_grammar.html), [pagination and exact count](https://docs.postgrest.org/en/stable/references/api/pagination_count.html).
