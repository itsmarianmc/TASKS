# Web Push: pre-implementation trace

Historical pre-implementation inspection on 2026-10-07. The findings below
describe the starting state; implementation/operation is in `WEB-PUSH.md` and
execution evidence is in `WEB-PUSH-VERIFICATION.md`. No live subscriptions,
Notion data or production database were inspected or changed.

## Existing contracts

- `src/lib/schemas.ts` validates local reminder instants and dismissal timestamps.
  `src/app/api/local/route.ts` calls `validatedJson` and the repository. Snooze
  replaces `reminderAt` and clears dismissal; edits persist through
  `setTaskMetadata`. The dispatcher must re-read metadata after remote checks
  and before each installation's send.
- `src/lib/server/task-service.ts` writes completion to Notion first, then records
  a local `completedAt`. The local timestamp can fail to persist and does not
  track edits made directly in Notion. It is not an authoritative open-task flag.
- `src/lib/server/notion-service.ts` persists graph snapshots and refreshes them
  every 30 seconds. `readGraph` can return a previous snapshot, including after
  a refresh failure; even strict reads can use an unexpired snapshot.
- `src/lib/server/notion.ts` returns `completed: false` when no completion
  mapping exists. Therefore false alone does not establish an open task.
  `getTask` performs a direct page read; `scopedPage` verifies task identity,
  configured data source and absence of archive/trash. A future dispatcher needs
  an explicit, validated completion-read contract, with unknown status causing
  no send. Schema ambiguity, unavailable properties, remote errors and missing
  tasks must never be interpreted as open. Remote edits between read and send
  remain an unavoidable race and must be documented.
- `src/lib/reminders.ts` retains reminders when the task is missing from the
  graph. This provides local context in the open app, but must not authorize
  server delivery when remote completion cannot be established.

## Subscription storage and API protection

- Migration 1 and `src/lib/server/db/schema.ts` contain
  `web_push_subscriptions`: unique endpoint, subscription ID, p256dh, auth and
  creation timestamp. Subscriptions are absent from `repository().snapshot()`.
  Keep endpoints and keys out of public snapshots, logs and error responses.
- There is no persistent push delivery ledger. A future additive migration
  should track task ID plus normalized reminder instant per installation, with
  attempts, retry time and accepted/uncertain outcomes. No destructive migration
  is required by this design. Browser push acceptance is not proof of delivery;
  a crash after acceptance can produce a retry duplicate. Stable notification
  tags can limit visible duplicates but cannot provide exactly-once delivery.
- `src/lib/server/http.ts` checks Origin, rejects cross-site requests, enforces
  JSON, bounds request bodies and sanitizes unexpected errors. APP_ORIGIN can
  explicitly pin the origin. These checks prevent cross-site browser actions;
  they do not authenticate arbitrary HTTP clients.
- No application login, middleware or proxy authorization was found. External
  access protection cannot be verified from this checkout. Before an endpoint
  can be considered safe, the operator must confirm its access boundary. A
  subscription endpoint must also reject arbitrary/private destinations and
  prevent disclosure or revocation of other installations' subscriptions.

## Process and worker lifecycle

- `src/instrumentation.ts` starts warmup only for the Node runtime. Warmup and
  database instances use global guards. The supported Docker runtime starts
  one `node server.js` process with a persistent data volume.
- Integrate a guarded, non-overlapping dispatcher into that process, with a
  bounded catch-up scan and bounded retries. Do not introduce another SQLite
  process. Existing migrations run transactionally under BEGIN IMMEDIATE.
  Build-time behavior must be checked against the installed Next documentation
  before adding dispatcher startup side effects.
- `src/components/pwa.tsx` registers `/sw.js` only in production and a secure
  context. The service worker intentionally does not call skipWaiting; updated
  code activates after old app windows close. This matters when enabling push
  against a previously installed worker without a push handler.
- `public/service-worker.js` has no push handler. Its existing notification click
  handler focuses a client and posts `open-reminder`, or opens
  `/?reminder=<taskId>`. Preserve caching/offline behavior.
- Open-app system notifications currently include task titles. Server push must
  use generic text and task context only. Suppress the open-app system sender
  only when this installation's server registration is confirmed; retain the
  in-app reminder list regardless of permission or connectivity.

## Implementation gates and verification

- `package.json` and the lockfile do not contain `web-push`. Proposed runtime
  dependency: https://github.com/web-push-libs/web-push, for VAPID and standard
  encrypted Web Push transport. Approval is required before adding it; no custom
  Web Push cryptography will be implemented.
- Follow-up: the user approved `web-push` and confirmed Cloudflare Tunnel plus
  Cloudflare Access as the external authorization boundary. The implementation
  therefore uses that boundary and the existing origin checks, without a new
  login model. Access configuration itself remains operator-verified.
- This checkout has no `node_modules`, so the required version-specific Next
  guides are unavailable. Restore existing locked dependencies before reading
  route-handler/instrumentation guides or writing application code. The folder
  also has no Git metadata, so Git cannot establish a clean/dirty baseline.
- No automated tests, typecheck, lint, build or device delivery have been run in
  this trace phase. No real pushes have been sent.
- After implementation, use an injected fake sender and isolated temporary
  SQLite for validation, configuration, eligibility, snooze/edit/dismiss,
  per-device deduplication, retries, restart recovery and expired endpoints.
- Real iPhone verification remains separate and pending: HTTPS, Home Screen
  installation, explicit permission button, closed-app reminder, tap and correct
  task/context. It requires access to a physical device and explicit permission
  for its test push; Chromium emulation does not satisfy this check.
