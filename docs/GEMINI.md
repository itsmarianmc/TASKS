# Gemini migration — 2026-10-04

## Result

TÆSKS retains its existing deterministic parser and application architecture. Optional Gemini extraction is now available only after an explicit capture action for insufficiently confident input. Results update the preview; a separate confirmation creates the task through the existing validated, guarded Notion path.

The audit found no installed old-provider SDK, client or implemented AI request path to delete. The obsolete reserved environment variables and documentation references were removed from `.env.example`, the local `.env`, README and specification. Existing unrelated environment values were preserved. No compatibility forwarding to another provider remains. `package.json` and `package-lock.json` now contain official `@google/genai` **2.27.0**.

## Files and configuration

- `src/lib/server/ai/gemini.ts`: isolated server-only adapter, pure text extraction, safe logs and output validation.
- `src/lib/server/ai/schema.ts`: strict Zod schema and constrained JSON Schema using existing task field names.
- `src/lib/server/ai/config.ts`: lazy environment configuration and safe status.
- `src/lib/server/ai/fallback.ts`: deterministic-first orchestration and graceful recovery.
- `src/app/api/parse/route.ts`: same-origin POST, authoritative graph/aliases/tags and server calendar context. No write operations.
- `src/app/api/ai/status/route.ts`: provider/model/configuration status without secrets or paid connectivity probes.
- `src/components/capture.tsx`: explicit inference, preview confirmation, cancellation and duplicate-request guards.
- `src/components/settings.tsx`: Gemini diagnostics. Provider names are absent from ordinary Quick Add.

Default model: [`gemini-3.5-flash-lite`](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite). API: stable [Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview), with `store=false`, JSON Structured Output, no tools, no search and no automatic retries.

| Variable | Default / purpose |
| --- | --- |
| `GEMINI_API_KEY` | Optional server secret; required only to activate AI fallback |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` |
| `GEMINI_FALLBACK_ENABLED` | `true`; set `false` to disable |
| `GEMINI_TIMEOUT_MS` | `5000` |
| `GEMINI_CONFIDENCE_THRESHOLD` | `0.75` |

The running environment currently has no Gemini key, so diagnostics correctly reports **not configured**. Deterministic capture and manual resolution remain available. Set the key in the existing `.env` and recreate the container to activate the optional fallback. A `ready` status means credentials are configured, not that a live request has succeeded.

## Validation and failures

The browser runs the deterministic parser while typing. A valid result above the threshold skips AI entirely. An explicit inference action is checked again on the server. Gemini receives only the task sentence, allowed names/IDs/aliases/tags, valid area/project pairs, resolved fields, current view and timezone/calendar date. No task history, contact messages, notes, attachments, private GitHub contents or credentials are sent.

After JSON Schema generation, Zod checks the exact response shape and field types. Independent checks reject unknown IDs, invalid relation pairs, invalid calendar dates or ordering, low confidence, invented tags and changes to resolved deterministic/context fields. German, English, mixed language, European numeric dates and explicit ranges keep existing semantics. Null relations remain unresolved for manual selection. Common examples, including `by Friday`, continue through rules alone. Complex residual phrasing such as `before school on Monday` reduces deterministic confidence.

Missing/disabled configuration, timeout, cancellation, 429, 5xx, unreachable models/network, malformed JSON, schema mismatch, invalid relations/dates and low confidence retain the deterministic result. The SDK deadline uses an AbortController plus an independent timeout; the browser also retains a bounded request deadline. Input/context changes invalidate old results, and input edits abort active requests. Repeated Enter cannot trigger duplicate AI calls or bypass the existing create guards. AI never writes directly to Notion or local storage.

Logs contain only provider, model, operation, duration, success and a fixed error category. Quick Add shows a short manual-resolution message. Docker health remains based on the app and SQLite, independent of Gemini.

## Executed verification

All normal tests mock Gemini; no paid model request or live Notion mutation was performed during this migration.

| Check | Result |
| --- | --- |
| `npm test` | **329 passed**, 20 files |
| Typecheck | Passed |
| ESLint | Passed |
| Production build with empty `GEMINI_API_KEY` | Passed |
| Full Docker browser regression, Edge desktop + mobile emulation | **78 passed**, 5.2 minutes |
| Final image: Gemini + health browser checks after final calendar/abort refinements | **12 passed**, 1.1 minutes |
| `docker compose build`, no dotenv files or keys in build context | Passed |
| No-key test container | HTTP 200, SQLite ok, Docker healthy, Gemini not configured |
| Dummy-key configuration test container | Diagnostics ready; test secret absent from response; no model call |
| Final `docker compose up -d --force-recreate` | Passed; existing `taesks_data:/app/data` retained |
| Final application at port 2015 | HTTP 200, SQLite ok, Docker **healthy** |
| Final Notion read | Successful diagnostics, 12 Areas / 19 Projects / 60 Tasks |
| Final 12 client JavaScript files | Zero Gemini SDK/secret-variable/key matches |
| Dotenv file inside final image | Absent |
| Obsolete provider references in source/tests/package/env/docs | Zero matches |

Final running image: `sha256:19b50f2eb7641de552904a66a0af28ddc5bc6cf08622a65b4675e84cd911d4d8`. The container is left running on the existing host port **2015**, with its existing volume. Temporary test containers and the temporary local server were stopped and removed.

New coverage lives in `tests/gemini.test.ts`, `tests/parse-route.test.ts`, `tests/health-reliability.test.ts` and `tests/e2e/gemini.spec.ts`. Adapter tests include real installed-SDK roundtrips over a mocked HTTP transport, including HTTP 429 without retries. Browser tests cover no requests while typing/creating clear tasks, one explicit inference, separate save confirmation, manual completion after failure and ignoring stale responses.

No live Gemini connectivity test was run because no real key is configured. Actual Safari/device installation is outside the browser-emulation evidence. The dependency audit still reports the five existing development-only Next ESLint dependency entries; none is in the new Gemini SDK dependency chain. No unrelated major-version dependency change was made. The workspace has no Git metadata, so the updated lockfile and source changes could not be committed here.
