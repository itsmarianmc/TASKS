# TÆSKS

A compact personal workspace for tasks, projects and notes. Notion holds your task structure; TÆSKS adds quick capture, planning views, Markdown notes, files, tags, reminders and saved filters. Optional GitHub activity and Contact messages provide context and can become tasks when you choose.

<p>
  <a href="https://github.com/itsmarianmc/TASKS"><img alt="Available on GitHub" height="40" src="https://cdn.jsdelivr.net/npm/@intergrav/devins-badges@3/assets/compact/available/github_vector.svg"></a>
  <a href="docs/DEPLOYMENT.md"><img alt="Read the documentation" height="40" src="https://cdn.jsdelivr.net/npm/@intergrav/devins-badges@3/assets/compact/documentation/generic_vector.svg"></a>
</p>

## Start with Docker

Requires Docker with Linux containers and Compose 2.24 or later. One image, one container and one persistent volume; SQLite is included.

```powershell
git clone https://github.com/itsmarianmc/TASKS
cd TASKS
cp .env.example .env
docker compose build
docker compose up -d
```

Open **http://localhost:2015**. The server listens on port 3000 inside the container as UID/GID 1001:1001. The `taesks_data` volume stores SQLite and uploads at `/app/data`. Without integration credentials, TÆSKS starts with setup diagnostics and no synthetic tasks.

All configuration is listed in [`.env.example`](.env.example). After changing environment values, recreate the container with `docker compose up -d --force-recreate`. Keep credentials server-side; never prefix secrets with `NEXT_PUBLIC_`.

**Protect access before exposing the app.** TÆSKS has no account system: use a VPN or authenticated reverse proxy. Mobile installation, offline caching and notifications require HTTPS (or localhost); a plain LAN HTTP address is insufficient. Set `APP_ORIGIN` to the exact public origin behind a proxy. [Operations, backups, access boundaries and Docker verification](docs/DEPLOYMENT.md).

## Set up Notion

1. Create or use three databases: **Tasks**, **Projects** and **Areas**. Share all three with the same Notion integration, allowing content reads, inserts and updates.
2. Tasks needs `Name` (title), `Due Date` (date), `Area` (relation to Areas), `Project` (relation to Projects) and `Highlight` (checkbox). Projects needs a title and a relation to Areas; Areas needs a title. Property names are configurable.
3. Link each project to its area(s). Each normal task must reference exactly one project and one area belonging to that project.
4. Set `NOTION_TOKEN`, `NOTION_TASKS_DATABASE_ID`, `NOTION_PROJECTS_DATABASE_ID` and `NOTION_AREAS_DATABASE_ID`. A database containing several data sources also needs its explicit `NOTION_*_DATA_SOURCE_ID`.
5. Open **Settings & diagnostics → Notion diagnostics**. Check the detected schema and select the completion checkbox or status mapping when needed. Completion is separate from Highlight. TÆSKS validates your schema; it does not add or modify properties.

[Detailed Notion setup, property types, completion and synchronization contracts](docs/NOTION.md).

## Capture and plan

Quick Add understands English and German dates, ranges, aliases and recurrence. Review its preview before creating a task. One date is a deadline with a start of today; numeric dates use European day/month order. Tasks stay in Notion; drafts and additional data stay in SQLite. Uncertain creates are never automatically repeated.

Use Overview, Today, Overdue, Next 7 days, Upcoming, Anytime, Someday and Highlight, or browse areas and projects. Search and the command palette cover loaded content. The interface supports desktop and mobile, light and dark themes, keyboard navigation and reduced motion.

Optional integrations:

- [GitHub](docs/GITHUB.md): read-only repository, issue, review, pull request, workflow and commit context. A fine-grained `GITHUB_TOKEN` needs the relevant read permissions; discovery does not prove access to every section.
- [Contact](docs/CONTACT.md): a separately operated PostgREST service. Server-side configuration and its external role/RLS determine read, mark and delete access. TÆSKS never changes that stack.
- [Gemini fallback](docs/GEMINI.md): optional AI for uncertain capture, requested explicitly. Deterministic parsing and manual correction work without a key. Results require review before creation.
- [PWA](docs/PWA.md) and [Web Push](docs/WEB-PUSH.md): previously visited content and device drafts can work offline. Closed-app notifications need production configuration, HTTPS, VAPID, a device subscription and the documented access boundary. Device delivery is not guaranteed.

## Languages and translation contributions

New users start in **English**. English and German ship in every image and work without network access. Compatible languages and updates are discovered from this repository's `main` branch every 30 minutes; open clients refresh configuration every five minutes. Application-code or incompatible schema changes still need a new image.

Optional `TRANSLATION_FOLDER_URLS` accepts comma-separated HTTP(S) folders, each containing `language.json` and `date-phrases.json`. External choices appear first with `[!]`, separated from repository choices. They have not been verified by the project. Both choices remain selectable when their language codes match; preferences retain the chosen source.

[Catalog specification, limits, refresh and migration from the old variables](docs/language-catalogs.md) · [Translator contribution guide](CONTRIBUTION.md).

## Development

Requires Node 24+ and npm. Read `AGENTS.md` and the locally installed Next.js documentation before modifying the application.

```powershell
npm ci
# Override a Docker DATA_DIR when developing on Windows.
$env:DATA_DIR = Join-Path (Get-Location) 'data'
npm run dev
```

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` and focused `npm run test:e2e` cases. E2E supports `E2E_BASE_URL` and `PLAYWRIGHT_CHANNEL=msedge`. Use isolated test storage and disabled integration credentials. Build/dev/test hooks generate the bundled catalog index automatically.

[Architecture](docs/ARCHITECTURE.md) · [Parser](docs/PARSER.md) · [Local persistence](docs/LOCAL.md) · [Reliability](docs/RELIABILITY.md) · [Historical verification](docs/VERIFICATION.md) · [Current language/startup verification](docs/english-experience-verification.md).

Badge artwork: [Devin's Badges by intergrav](https://github.com/intergrav/devins-badges), using its [compact badge reference](https://intergrav.github.io/devins-badges-docs/badges/compact/).
