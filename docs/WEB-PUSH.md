# Operating Web Push

## Configuration and access boundary

Run one production Node 24+ server (`next start` or the existing standalone
Docker server), with its existing persistent SQLite data directory. No cron,
sidecar, second SQLite process, serverless runtime or multi-replica deployment
is supported for this dispatcher. `src/instrumentation.ts` starts it once in
the Node runtime. It does not run in development or the Next production-build
phase. Missing/invalid push configuration starts no dispatcher.

Set `APP_ORIGIN` to the externally visible HTTPS origin, with no path, query or
credentials. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` as
server environment variables at runtime; do not use `NEXT_PUBLIC_` or put the
private key in a Next config. Generate a pair once locally:

```powershell
node node_modules/web-push/src/cli.js generate-vapid-keys --json
```

Store this output securely, outside logs and version control. Use a real contact
`mailto:` address or HTTPS URL as subject. Key pairs are validated; an absent or
invalid pair leaves push unavailable without breaking in-app reminders or build.
`GET /api/push` returns only availability, a generic reason and the public key,
with no-store. This dedicated endpoint is not added to offline read caching.
Rotating VAPID keys requires each device to enable push again, replacing its
browser subscription. Preserve the keys and database across ordinary restarts.

The operator confirmed Cloudflare Tunnel + Cloudflare Access as the external
authorization boundary. Apply Access to the entire hostname and every API path,
including `/api/push` and `/sw.js`. Restrict direct access to the origin port so
it cannot bypass Access. No application login or multi-user model is introduced.
The existing same-origin JSON/body validation is additional CSRF protection,
not a replacement for Access. Verify this deployment boundary operationally;
it was not probed or changed during implementation.

The server must reach browser push endpoints over outgoing HTTPS. The supported
endpoint hosts are subdomains of `push.apple.com`, `fcm.googleapis.com`,
`updates.push.services.mozilla.com` and regional `*.notify.windows.com` names
with one alphanumeric/hyphen label. Arbitrary hosts, HTTP, credentials, custom
ports and fragments are rejected; the sender does not follow HTTP redirects.
If a vendor changes endpoint hosts, enrollment deliberately fails until this
allowlist is reviewed. No external push intermediary has been added.

## Installation and lifecycle

On iPhone/iPad, use an iOS version supporting Web Push in Home Screen apps
(iOS/iPadOS 16.4 or later), HTTPS, Share → Add to Home Screen, and open that
installed app. Actual feature detection governs availability. In Settings,
press Enable push to grant notification permission and register this device.
Browser permission alone does not enroll it. Old workers without the handler
must finish their normal update: close all app windows, reopen and retry.

Enrollment stores endpoint, encryption/auth keys and a hash of a random device
capability in SQLite. The capability stays in device storage and is required
to replace, inspect or revoke this installation; there is no subscription-list
API. Endpoints/keys never enter the local snapshot or log output. These values
and the capability are confidential; protect database backups and browser
storage accordingly. The global single-user app still depends on Access.
At most 256 subscriptions can be registered. Existing unowned legacy rows are
preserved by migration but not dispatched; they must not be silently claimed.

Disable push first revokes server delivery, then unsubscribes in the browser.
If offline or Access has expired, revocation fails visibly and remains retryable.
If browser storage is cleared, the device can lose its capability; disable the
remaining browser subscription and re-enable to create a fresh one. Old expired
endpoints are removed when a sender receives 404/410. Browser subscription
renewal is reconciled while the app is open or by pressing Enable push again;
there is no promise of unattended renewal while an app remains closed forever.

## Eligibility, deduplication and failures

Reminder timestamps/dismissal are local SQLite metadata; completion and
archive/trash state are Notion authority. Each send performs a fresh schema and
page read with a verified completion mapping and configured Tasks data source.
Missing/ambiguous completion, a missing/null/invalid completion value, unavailable
Notion, wrong source and deleted/archived tasks result in no send. `completed:
false` from an old graph or from a missing mapping is not used as evidence.
Configure completion in the existing Notion settings without changing the Notion
schema. Local `completedAt` records only app-confirmed completion timestamps.

After the remote check, re-read local metadata and the current subscription,
then claim the delivery synchronously before invoking the sender. Snooze,
dismissal, changed instant or revocation during the remote check cancels that
attempt. An edit made after sender invocation or between the Notion read and
send cannot retract an in-flight push; the app loads current data on tap.

The dispatcher starts after five seconds and scans again 30 seconds after the
previous run finishes. Runs cannot overlap. A rotating batch checks at most 20
task/installation pairs per run, so unknown early tasks do not starve later ones.
Provider/network delays and Notion rate limiting can postpone delivery. Reminders
up to 24 hours overdue are eligible after downtime; older reminders remain in the
app but are not pushed. Provider TTL is five minutes, limiting stale queued pushes.

Migration 6 is additive. It adds device ownership and `push_deliveries`, whose
primary key is installation ID + task ID + normalized UTC reminder instant.
Accepted deliveries survive restart and are not sent again for that key. Snooze
or a new reminder instant has a new key. Provider acceptance is not proof that
the OS displayed a notification, and tapping does not dismiss the reminder.

A send is persisted as `sending` before contacting the provider, with a five
minute lease. After a crash, an expired lease can be retried. If acceptance was
lost before it could be persisted, retry can duplicate a push. The stable tag
replaces the existing system notification where the browser supports this; it
cannot provide exactly-once delivery. Five attempted sends are the maximum.
Network uncertainty, 429 and 5xx retry with 30/60/120/240-second backoff; each
attempt revalidates eligibility. Other errors exhaust the delivery. 404/410 remove
the expired endpoint and its ledger, without deleting a replacement endpoint.
An exhausted delivery requires operator diagnosis; the app does not silently
reset it every run. Config/key changes do not clear accepted delivery history.
Old, inactive ledger rows are pruned after 30 days; active reminder keys remain.

Logs contain aggregate sent/failed/unverified counts and generic failure codes,
not endpoints, keys, device tokens, task IDs, content or raw provider errors.
Push payload contains type, task ID, reminder instant and a hashed stable tag.
The notification uses fixed generic text, never a task title or note. Titles in
the pre-existing open-app-only notification fallback remain unchanged. Devices
with a confirmed push registration suppress that fallback across app windows;
in-app reminders still display. Server status is reconciled on open/focus and
every minute, retaining the last confirmed state during network outages.

## Physical iPhone acceptance — pending

No physical iPhone was available to this implementation session, and no real
pushes were sent to private/production devices. Automated browser fakes,
worker execution and Chromium UI checks do not prove Safari/OS delivery.
Perform this separately on a deliberately selected test installation after
operator-controlled deployment; do not use a production reminder accidentally.

1. Open the HTTPS hostname through Access and add TÆSKS to the Home Screen.
2. Open the installed app, press Enable push, grant permission and verify Enabled.
3. Create a test reminder for a known open task with a verified completion mapping.
4. Close all app windows; keep the server running. Confirm a generic system
   notification arrives with no task title or notes.
5. Tap it; verify the correct task or retained local context opens. If Access has
   expired, sign in and verify the task parameter survives that redirect.
6. Keep the app open for another test reminder; verify one system notification
   and a useful in-app reminder. Test Snooze, Dismiss, completion before due time,
   a second installation, server restart and Disable push.
7. Record iOS version, device, browser/PWA state, timestamps, Access session state
   and observed outcomes. Record missed/late delivery honestly. OS notification
   settings, Focus modes, connectivity and provider availability remain limits.

Automated execution results and remaining build/device limits are recorded in
[WEB-PUSH-VERIFICATION.md](WEB-PUSH-VERIFICATION.md).
