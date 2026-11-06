# English experience and ordered startup verification

Implemented and checked on **1 November 2026 (Europe/Berlin)** in the existing checkout. It was clean at the initial inspection. No deployment, publishing, production-container change, real Notion mutation or credential change was performed. Dependencies were installed from the lockfile because `node_modules` was initially absent. The installed Next.js guides for server/client components, route handlers, asynchronous headers and standalone output were read before code changes; the managed agent-rules generator was also inspected.

## Implemented behavior

- New users start in repository English regardless of browser language. Saved code-only preferences resolve to the repository; new preferences identify the exact source. External/repository duplicates remain separate choices, as requested.
- Settings lists native external names first with `[!]`, an accessible unverified-translation explanation and a separated repository group. UI, document locale, selected date phrases, parser endpoint and generic worker notification copy resolve the same source identity. Missing sources fall back to repository English while retaining their saved identity.
- Build hooks discover actual locale folders and generate a validated JSON bundle. English and German work offline. Runtime discovery explicitly lists public repository `main`, pins files to one commit, refreshes every 30 minutes and keeps a JSON-compatible in-memory index/last-good cache. Open clients poll configuration every five minutes.
- Server-only `TRANSLATION_FOLDER_URLS` replaces the two direct-file variables. Each folder supplies the two known filenames as one validated pair. Limits, joining, credentials/redirect rules, compatibility, safe diagnostics, fallback and legacy migration are documented in [the catalog specification](language-catalogs.md).
- Splash reads are gated in displayed order: local restoration/cached graph, Notion, required configuration, GitHub, Contact, preparation. Later rows stay pending. Unneeded source reads begin after the workspace opens. Bounded API deadlines and terminal source failures release later steps. Notion failure without a graph now opens the available workspace/diagnostics with a warning; failure to restore the required local store offers an explicit safe retry. The existing hold, handoff, focus protection and reduced-motion behavior remain.
- The README is concise English with actual reference-listed Devin's Badges. Operational, backup and access details moved to [deployment](DEPLOYMENT.md). [Notion setup](NOTION.md) now includes the adapter's required types/targets, optional metadata, completion mapping and data-source selection. [CONTRIBUTION.md](../CONTRIBUTION.md) explains translation work and tests.
- Remaining German explanatory documentation was translated/revised. German user vocabulary and parser examples remain intentional. Historical results/dates and limitations are preserved; the original long product brief is an English editorial edition, clearly marked as requirements rather than current verification. Unavailable historical screenshot artifacts are recorded as paths instead of broken links.

## Checks and results

| Check | Result |
| --- | --- |
| Focused catalog, bundle generation, parser, SSR, worker and startup unit checks | 69 passed across 7 files |
| Full Vitest suite | **550 passed, 4 pre-existing failures**, 554 cases / 38 files |
| TypeScript | Passed |
| ESLint | Passed, no warnings after temporary test artifacts were removed |
| Standard Linux Docker production build (`npm run build`, Turbopack) | Passed, including generated bundle, TypeScript and static generation |
| Focused production browser suite | **56/56 passed**, Edge desktop and Chromium iPhone viewport/touch emulation |
| Network-disabled, read-only Docker runtime | Passed: UID 1001, health ok, bundled English/German, English-first SSR despite German request headers, persisted German choice, German SSR and service-worker copy |
| Running-image discovery and external folders | Passed with controlled transport/clock fixtures: initial bundles, external German plus repository German, then new repository French in the same image/process |
| Diff whitespace and local Markdown targets | Checked |

The final browser command was `npx playwright test tests/e2e/english-startup.spec.ts tests/e2e/startup.spec.ts tests/e2e/catalog-interactions.spec.ts --workers=2`, with `E2E_BASE_URL=http://localhost:2017` and `PLAYWRIGHT_CHANNEL=msedge`. Local results are generated under `test-results/english-final`. Tests cover delayed/failed sources, a single active step, pending later rows, saved/uncached/offline responses, explicit local retry, splash handoff/reduced motion, unchanged user titles, source grouping, duplicate selection, reload/disappearance/recovery, Undo, manual dates and refresh arrivals. A mobile splash screenshot was visually inspected.

Catalog unit fixtures cover folder resolution/encoded commas, malformed/missing/mismatched files, unsupported schemas and missing keys/placeholders, size/count/concurrency limits, deadlines even when transport ignores abort, safe errors, GitHub 403/429/503, invalid listings, same-process refresh/new folders and last-good fallback. The bundle test creates an actual additional locale folder in isolated temporary storage and invokes the real generator without a manifest edit. Parser/worker tests distinguish same-code sources.

Docker used only disposable `taesks-english-qa-20261101`, `taesks-languages-offline-20261101` and `taesks-languages-refresh-20261101` containers, read-only application filesystems, temporary data mounts and disabled real integrations. The offline/refresh containers used `--network none`. The refresh check mounts `tests/fixtures/catalog-runtime.mjs` read-only via `NODE_OPTIONS=--import=...`; this test-only transport supplies synthetic GitHub/external JSON and accelerates only the discovery timer/clock. It is excluded from production images with the rest of `tests/`. Production refresh intervals were not shortened. The final tested local image manifest is `sha256:247bd8b89adccf895bc89737fceb0125180785275ace609e40671cc2f4316f3a`. Disposable containers were removed after checking them.

## Existing failures and environment limits

The same four adapter failures were present before the catalog/discovery implementation and remain outside this change:

- `tests/contact.test.ts:12`: retained stale cache reports `ok` where the test expects `error`.
- `tests/github.test.ts:60`: the equivalent stale-cache status expectation.
- `tests/notion.test.ts:282`: `RELATION_UNAVAILABLE` instead of expected `RELATION_CONFLICT`.
- `tests/notion.test.ts:295`: stale graph completion availability differs from the expectation.

Native Windows `npm run build` failed when Turbopack's CSS subprocess exited before connecting. A native Webpack attempt failed with filesystem `EPERM` creating `.next/static/chunks/app/api/contact`. Neither is presented as a passing Windows build. The normal Linux Docker build passed. Initial sandboxed test/browser attempts had temporary-file or process-launch restrictions; the successful unit run used isolated writable temporary storage, and browser/Docker commands used the approved tool path. SSR fixture handling was corrected for full catalogs and shared props; the final complete browser run passed.

Live GitHub discovery correctness was tested with deterministic fixtures, not claimed from a live service response. No real Notion, GitHub account, Contact writes, Gemini request, physical Safari/iOS/Android, installed-device PWA or OS/closed-app push delivery was verified. Persistent-volume backup/restore and restart durability were not retested in this change; earlier deployment evidence remains historical. Remote caches are process memory and restart from the baked-in bundle. New application code or incompatible catalog contracts can still require a new image.
