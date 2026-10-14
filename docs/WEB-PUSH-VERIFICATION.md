# Web Push verification — 2026-10-07

Implemented subscription lifecycle, direct Notion eligibility, per-installation
delivery persistence, in-process production dispatcher, worker push handling,
settings and operating documentation. Runtime dependency `web-push` 3.6.7 was
explicitly approved; `@types/web-push` is a development dependency. No deployment,
real push, private device enrollment, live Notion write or production database
change was performed.

## Guides and checkout

Read `AGENTS.md` and the installed Next 16.3.8 documentation:

- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/02-guides/instrumentation.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md`
- `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`
- Build options in `01-app/03-api-reference/06-cli/next.md`.

The initial checkout had neither Git metadata nor dependencies. `npm.cmd ci`
initially failed with registry DNS restrictions in the sandbox, then succeeded
with network access outside it. The approved library and its types were installed
with `npm.cmd install web-push --save` and
`npm.cmd install --save-dev @types/web-push`. The install reported five high
audit findings; no broad dependency upgrade or audit fix was made. Git cannot
establish the original clean/dirty state in this checkout. Concurrent startup
work also changed other files during this session; those changes were preserved.

## Automated commands and results

```powershell
npm.cmd test -- tests/push.test.ts tests/push-route.test.ts tests/push-worker.test.ts tests/push-client.test.ts tests/service-worker.test.ts tests/pwa.test.ts tests/repository.test.ts tests/task-service.test.ts
# 8 files, 93 tests passed.

npm.cmd test -- tests/notion.test.ts -t reminder
# 4 passed, 28 skipped; all four new direct Notion eligibility cases passed.

npm.cmd run typecheck
# Passed on the final source/test state.

npm.cmd run lint
# Passed on the final source/test state, no warnings in the final run.
```

These 97 targeted checks use browser mocks, the actual worker script in a VM,
mock Notion transport and isolated in-memory/temporary SQLite. No sender reaches
a real browser push provider. Coverage includes configuration validation,
same-origin/JSON API validation, bounded/allowlisted subscriptions, owning-device
replacement and revoke, secret-free responses, permission gesture timing,
unconfirmed enrollment retry, offline status/revocation, worker capability,
generic notification content, click context, future/due/dismissed/completed/
unknown/missing/archived tasks, snooze/changed timestamps during status reads,
per-installation deduplication, equivalent-instant normalization, real SQLite
reopen, interrupted-send leases, retry limits, 404/410 expiry, replacement races,
non-overlapping dispatcher runs and fairness behind unknown statuses.

The larger related run including all `tests/notion.test.ts` cases returned
121 passed and two failed (before the last two new eligibility tests were added).
The failing existing tests are:

- `validates relations on the server and scopes edits/deletes to configured tasks`:
  expected RELATION_CONFLICT, received RELATION_UNAVAILABLE after a cached read.
- `keeps explicitly stale graph after read failure and refuses writes using stale relations`:
  expected completionEnabled=false, received true from the retained snapshot.

Both failures were reproduced with the new reminder eligibility method removed
temporarily, using the same mocked tests. The current file was restored in a
finally block. They therefore predate that method; unrelated graph/write cache
semantics were not changed for this feature. The dispatcher bypasses that graph
path. The full repository test suite and full browser E2E suite were not run.

## Production build and server smoke tests

Build/start commands used a separate temporary DATA_DIR, blank NOTION_TOKEN,
GITHUB_TOKEN, GEMINI_API_KEY, CONTACT_API_AUTH_HEADER and all VAPID values, with
CONTACT_API_BASE_URL=http://127.0.0.1:9. Process environment overrides `.env`.
No live integration credentials or production SQLite were used.

```powershell
npm.cmd run build
# Failed in Turbopack creating its Node helper for globals.css.
# The same failure occurred outside the sandbox; no source/config workaround.

npm.cmd run build -- --webpack
# Passed, including TypeScript and standalone output, on the final app source.

npm.cmd start -- --port 41273
# Temporary isolated smoke server; stopped after checks.

# With isolated environment, PORT=41274, HOSTNAME=127.0.0.1:
node .next/standalone/server.js
# Same single-process startup used by Docker; stopped after checks.
```

For the standalone smoke, copied only `public/service-worker.js` into its build
output's public directory to mirror that part of Docker's public copy. This was
not an installation/browser/offline-shell test. `next start` emitted the existing
standalone-output warning, so the actual standalone server was checked separately.

Local HTTP results on the built application:

- Health: 200.
- `/api/push`: 200, `available:false`, `publicKey:null`, Cache-Control=no-store.
- `/sw.js`: 200, actual push handler present.
- Valid-shaped enrollment with missing VAPID configuration: 503.
- Cross-origin enrollment: 403.

The standalone server separately returned health=200, push-config=200 with
availability=false/publicKey=null, and worker=200 with the push handler. Local
HTTP probes required execution outside the sandbox because it denied localhost
connections. Test servers were stopped. The production container/image/volume
was not changed. A configured dispatcher start against real credentials/providers
was deliberately not exercised.

## Remaining acceptance and operational boundaries

Physical iPhone HTTPS/Home Screen/permission/closed-app delivery/tap verification
is **pending**. No Safari/real device, Cloudflare Access policy/redirect, outbound
provider reachability, OS notification delivery or live Notion completion mapping
has been verified in this session. Browser mocks cannot prove those behaviors.
No assertion of exactly-once delivery is made. Manual acceptance steps are in
[WEB-PUSH.md](WEB-PUSH.md#physical-iphone-acceptance--pending).

Platform prerequisites are documented by
[WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
Apple's endpoint/notification requirements are in
[Apple's Web Push documentation](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).
The approved transport's API is documented by
[web-push](https://github.com/web-push-libs/web-push).
