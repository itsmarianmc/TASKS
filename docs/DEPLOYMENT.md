# Docker deployment

TÆSKS uses one application image `taesks:local`, one permanent container `taesks`, host port **2015** → internal **3000**, Docker's existing bridge and one named volume **taesks_data** at **/app/data**. No Postgres/Redis service, Docker-in-Docker, external network dependency or Contact-stack mutation is introduced.

## Runtime contract

The multi-stage Dockerfile installs lockfile dependencies under Node 24, builds Next 16.3.8 with TypeScript, and copies only standalone output, `.next/static` and `public` into its runtime stage. UID/GID **1001:1001** owns the data directory and the runtime files. `HOSTNAME=0.0.0.0`, `PORT=3000`, `NODE_ENV=production`, `DATA_DIR=/app/data`; Compose fixes these even when `.env` has a development Windows path. Runtime credentials come from optional `.env`, never Docker build arguments. `.dockerignore` excludes all dotenv credentials, node_modules/builds, development data, fixtures, results and temporary QA helpers.

Health executes Node fetch against `/api/health` and requires HTTP 200 plus `status:ok` and `services.localDatabase:ok`. Optional upstream sources do not govern Docker health. External `configured` status is a configuration indicator; actual adapter diagnostics prove reads independently. Graceful stop allows 30 seconds. Restart policy is `unless-stopped`.

Start:

```text
docker compose build
docker compose up -d
```

Open `http://HOST:2015`; protect access externally. Set `APP_ORIGIN` to the visible HTTPS origin when using a reverse proxy; leave blank for direct host-derived checks. Smartphone PWA APIs require HTTPS or localhost. Backups and restoration are described in the README; preserve the whole stopped `/app/data`, including SQLite WAL/SHM and uploads, and restore writable ownership 1001:1001. Do not run two server processes on one volume or use `down -v` during an ordinary update.

## Executed evidence — 2026-10-04 Europe/Berlin

- Read-only Docker inventory before deployment: no existing `taesks` container and no volumes. Development data and existing `.env` were neither copied nor altered.
- `docker compose build`: exit 0, actual Linux image produced, optimized Next production build and embedded TypeScript passed. Build context was approximately 802 kB; no credentials were passed to build.
- The single container was first started with owned fresh volume `taesks_qa_20261004_684b1d`. A temporary ignored Compose override set Notion/GitHub tokens and Contact auth explicitly to empty strings, Contact to `http://127.0.0.1:9`, Origin to `http://localhost:2015`. This prevents live external mutation during fixture/PWA tests.
- Runtime `id`: **uid=1001, gid=1001**. Health HTTP 200 and Docker **healthy**. Port mapping confirmed **2015:3000**, one mount `/app/data`. SQLite applied exactly **3 migrations**, data directory owner **1001**.
- Real API writes created one owned uniquely named draft, project-context Markdown note and UTF-8 text upload. Actual download bytes matched SHA-256. All three remained after both `compose restart` and `compose up -d --force-recreate` on the QA volume; no Notion source write occurred in these persistence tests.
- Read-only image archive scan decoded **10 gzip layers** and compared **3 configured secret values** with **277,035,161 uncompressed bytes** from the **93,650,944-byte** actual image archive: **zero hits**. Eight served client scripts also had **zero hits**. Root HTTP 200/CSP no unsafe-eval, SW HTTP 200/no-store/root scope/build-generation replacement, manifest and all three icon URLs passed. Actual runtime Node is **24.21.0**; image digest is `sha256:1efd1e92e76dc5155205e12c57b34ac2225149c2f97e74a2af18bc3f3d574e67`.
- Final TypeScript/lint and **261 unit/integration tests / 17 files** passed. The first full browser command returned 61 passed/1 failed in 6.0 minutes: a deliberate duplicate Enter produced both a warning and a replay-guard alert, so an old broad alert selector was ambiguous. The assertion was narrowed to its intended warning; no app behavior was changed. A subsequent **single full command passed all 62 cases, exit 0, 4.7 minutes**: `npm run test:e2e -- --workers=2 --output=test-results/deployment-clean-684b1d`, `E2E_BASE_URL=http://localhost:2015`, `PLAYWRIGHT_CHANNEL=msedge`. Exactly one runner was active; the container was externally managed. Core/local/PWA/health cases exercised actual Docker SQLite/files and the real production worker where intended; only upstream fixture responses are synthetic.

## Configured live adapter and owned CRUD evidence

The container was recreated on fresh permanent **taesks_data** with the existing unchanged `.env`; the image remained the exact tested digest. Actual `/api/graph?refresh=1` returned **12 Areas, 19 Projects, 60 Tasks**, successful Notion diagnostics and **completion enabled**. Actual schema discovery exposed **7 task, 8 project, 7 area properties**, with valid mapped types/targets. No schema mutation occurred.

Actual `/api/github?refresh=1` returned **42 repositories**, successful assigned-issue/review sections (zero current items). A selected accessible repository's independent reads succeeded: issues **0**, pulls **0**, actions **50** with more pages, commits **50** with more pages. This verifies the displayed scopes; it does not promise every repository's permissions. No GitHub write was made.

Actual `/api/contact?refresh=1` returned **status ok, 1 record, total 1, unread 1**. These are adapter reads from inside the final container, not mere configured flags or browser fixtures. No live Contact mutation occurred.

Exactly **one** UUID-titled owned temporary Notion QA task was created through `/api/tasks`, using an existing valid Project and one of its existing Areas. The POST was issued once and returned a confirmed task ID. Its own title, Highlight and ISO date range were edited; forced graph reads verified fields and relations. Completion true and reopen false were each verified through their response and a forced graph. Only that owned ID was then archived with `{confirmed:true}`; the adapter confirmed deletion and the forced graph proved it absent from active tasks. No recurrence/source/tags/metadata were supplied; no local QA extensions remained. Existing source tasks/projects/areas were never changed.

After the final configured container restart, all adapter reads passed again with the same counts and successful selected GitHub section statuses. The permanent database had **3 migrations, 16 local tables, 0 local records** and runtime UID **1001**. Production headers/worker/manifest/icons and decoded image/client secret checks passed again with real runtime credentials. The explicitly owned QA volume was removed only after verifying its Compose project label and that the running container mounted **taesks_data** instead. Final `compose up -d --wait --wait-timeout 60` confirmed **running / healthy**, port **2015**, UID/GID **1001:1001**, the exact tested image digest and one permanent volume. The final container is left running.

## Verification boundaries

Browser coverage uses installed Edge Chromium desktop and iPhone viewport/touch emulation. Actual Safari/iOS, device-installed PWA, OS notification delivery and closed-app push are not proven. AI fallback was disabled in this initial deployment; the subsequent [Gemini migration](GEMINI.md) enables an optional server-only fallback. Closed-app Web Push stays disabled. Live Contact writes are deliberately untested: the separate service role/row policies determine read/unread/delete permission. GitHub is read-only. No schema or existing source item is modified for QA. The final local volume is separate from QA, so fixture drafts, reminder metadata, preferences and uploads are never handed over as production data.
