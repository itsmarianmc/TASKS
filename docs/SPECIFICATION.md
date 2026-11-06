# Original product specification

This is the original implementation brief, edited into English and condensed to remove repetition. It records requirements and examples, **not verification that every feature works**. The original project began in an empty folder; its execution/deployment instructions are historical, not authorization for later agents to deploy or change external data. Current behavior and verification limits are documented in the individual integration and verification guides.

## 0. Original working method: sequential agents

Divide the original build into meaningful specialist tasks, using only one subagent at a time. Start an agent, wait for completion, inspect its changes, check TypeScript and architectural compatibility, integrate the result, and only then start the next. Suggested order: architecture/data model, design/UI, Notion, parser, core task UX, GitHub, Contact, local persistence/resources, PWA/mobile, security/reliability, Docker/deployment, final QA. The lead engineer owns integration and regression prevention; this specification takes precedence over agent assumptions.

## 1. Product idea

TÆSKS is a personal central task and productivity application. The Æ is intentional branding. Study the supplied init.Tasks images/videos for information architecture, typography, density, trees, tasks, inline metadata, colors, Quick Add, mobile navigation, projects, notes, attachments, sidebar and keyboard interaction. Adopt the interaction model and density while establishing a separate identity, drawing inspiration from init.Tasks, Linear, Things and modern terminal interfaces. Avoid a generic SaaS administration dashboard.

## 2. Design principles

Use a terminal-inspired, monospace-first, compact, keyboard-first, hierarchical interface. Prioritize content, speed, calmness and readable density. Use few cards, minimal borders/containers and inline metadata. Provide complete light/dark themes, responsive layouts and equal desktop/mobile usability. Avoid tile dashboards, oversized statistics/buttons, excessive radii, pervasive glass effects, generic component-library demos, decorative icons and excessive spacing. Radix/shadcn primitives may support accessibility but must use TÆSKS styling.

## 3. Branding

Use minimalist text/symbol branding with a recurring Æ, without elaborate illustrations. Suggested accent: mint/turquoise/terminal green. Semantic colors: red for overdue/errors, orange/yellow for deadlines/warnings, blue for links/metadata, purple for GitHub/secondary context and gray for notes/comments. Adapt contrast to both themes. Use a free bundled monospace font or a robust system stack; do not depend on proprietary fonts.

## 4. Technology

Preferred stack: Next.js App Router, TypeScript, React, Tailwind CSS, accessible Radix primitives, Zod, TanStack Query or an equivalent query abstraction, official Notion SDK, Octokit, chrono-node, date-fns, Drizzle and SQLite. Use a normal Node.js server, not Edge runtime for SQLite or other Node APIs.

## 5. Docker architecture

One image and one application container, with SQLite rather than additional PostgreSQL/Redis services. No Docker-in-Docker. Persist `/app/data`, including `/app/data/taesks.db` and `/app/data/uploads/`, using a volume or bind mount. Internal port 3000 maps to host **2015** (`T=20, A=1, E=5`). Provide a multi-stage Dockerfile, Compose, `.dockerignore`, `.env.example` and health check. The original acceptance commands were `docker compose build` and `docker compose up -d`, followed by `http://HOST:2015`.

## 6. External access protection

No built-in accounts, registration, OAuth or password screen. A reverse proxy, VPN or internal infrastructure restricts access. Still enforce server-only secrets, validated routes, appropriate CSRF boundaries, secure headers and XSS protection. Never inject unsafe HTML.

## 7. Data source ownership

Notion is the source of truth for core tasks. GitHub, the separate Contact PostgREST API and TÆSKS SQLite have distinct responsibilities. Issues and contact submissions remain external items until the user explicitly creates a Notion task from one.

## 8. Notion data model

Use Tasks, Projects and Areas. The supplied database screenshots describe the original schema. The hierarchy is Area → Project → Task. Each normal task has exactly one area and one project; the project must belong to that area. An area may contain multiple projects. Original school examples preserve user vocabulary:

| Area | Project | Task |
| --- | --- | --- |
| Hausaufgaben | Physik | Lorentzkraft berechnen |
| Hausaufgaben | Englisch | Make Presentation |

Area is the organizational category, project is the concrete project/subject, and task is the action.

## 9. Tasks database

Original visible properties: `Name` (title), `Due Date` (date/range), `Area` (relation to Areas), `Project` (relation to Projects), `Highlight` (checkbox). Example range: October 3, 2026 → October 18, 2026. Read and validate the remote schema; keep property names configurable with these defaults:

```dotenv
NOTION_TASK_TITLE_PROPERTY=Name
NOTION_TASK_DATE_PROPERTY=Due Date
NOTION_TASK_AREA_PROPERTY=Area
NOTION_TASK_PROJECT_PROPERTY=Project
NOTION_TASK_HIGHLIGHT_PROPERTY=Highlight
NOTION_TASKS_DATABASE_ID=
NOTION_PROJECTS_DATABASE_ID=
NOTION_AREAS_DATABASE_ID=
NOTION_TOKEN=
```

Discover a plausible completion checkbox/status such as Done, Completed, Complete, Status or State. Use a unique safe candidate, otherwise require a diagnostics selection. Do not guess or automatically modify the user's schema. The current adapter never creates properties; see [Notion contracts](NOTION.md).

## 10. Projects database

Original screenshots included Name, Status, Priority, Areas, Tasks and optional Date/Deadline. Example names: GYM, Habit Tracker, HealthSync, Notion, Paperless Chat, Portfolio, SchulPlaner, Shoply, TÆSKS and Bildende Kunst. Example status values: In Progress/Done; priorities: High/Medium/Low. Surface useful project metadata and area relations without hardcoding the example vocabulary.

## 11. Areas database

Original visible fields included Name, Type, Open Projects, Projects, Tasks and Database. Examples: Private, Web Development and Homelab, with Work/Personal types. Validate schemas at runtime; not every screenshot column is a required writable property.

## 12. Notion task CRUD

Support create/read/edit/complete/reopen, moving area/project, dates, Highlight and confirmed deletion. Only use optimistic changes with safe rollback. Failures must explain the problem and restore affected state without claiming unconfirmed success.

## 13. Relation validation

A project with one area may infer that area. For multiple areas, require a selection. Validate explicit parser assignments together. Never silently save incompatible pairs: explain, for example, that project “Englisch” does not belong to area “Web Development”, and require correction.

## 14. Local persistence

Keep Notion core fields authoritative. Store additions in persistent SQLite with migrations: task metadata, notes, attachments, links, tags/task tags, saved filters, parser aliases, project integrations, external item links, Inbox drafts, preferences and optional push subscriptions. Example metadata: Notion task ID, priority, recurrence, reminder, Someday, creation/update timestamps. Use generic task/project/area resource references where appropriate.

## 15. Notes

Provide editable, well-rendered Markdown with headings, lists, code blocks, inline code and links. Store notes in SQLite and allow substantial project notes. Example content:

```markdown
## Architecture
Notion stays the source of truth.
### GitHub
- PRs
- Issues
- Actions
### Contact API
- unread submissions
- create task
```

## 16. Attachments and links

Support files, images, PDFs and ordinary links. Store files in `/app/data/uploads` and metadata in SQLite. Present compact filenames, types/sizes and links rather than oversized file cards. Example: `specification.pdf 1.2 MB`, `notes.txt 3 KB`, `screenshot.png 207 KB`.

## 17. Task details

Alongside Notion fields, support local Markdown, links, attachments, reminders, recurrence, priority, tags and Someday. Detail fields: title, area, project, start, deadline, Highlight, priority, tags, reminder, repeat, notes, links, attachments, external references and delete.

## 18. Quick Add

Quick Add is central. Natural input such as `Make Presentation in English as Homework until the 03/10/2026` should resolve the title, existing project/area, start of today and deadline of 3 October 2026. Preserve configured aliases to existing `Englisch` / `Hausaufgaben` names. Preview results before creation.

## 19. Natural-language parser

Understand English and German. Required examples include:

```text
Make Presentation in English as Homework until Friday
Präsentation in Englisch als Hausaufgabe bis Freitag
Math homework tomorrow
Geschichte Präsentation bis 12.10.
Finish API in TÆSKS until next Monday
Physik Hausaufgabe morgen
```

Use normalization → explicit tokens → dates → project matching → area matching → tags → context defaults → relation validation → confidence → optional LLM only when necessary. An LLM is not the default parser.

## 20. Explicit syntax and aliases

Support `#Project`, `@Area`, `[tag]`, for example `Make Presentation #English @Homework [school] tomorrow`. Load project/area names from Notion and store aliases locally. Original examples: Englisch → English/Eng/english class; Hausaufgaben → Homework/HW/Hausi. Short forms must be unambiguous.

## 21. Dates

Build on chrono-node with appropriate extensions. German examples: `heute`, `morgen`, `übermorgen`, `Freitag`, `nächsten Freitag`, `bis Freitag`, `am 12.10.`, `12.10.2026`, `12/10/2026`, `in 2 Wochen`, `in drei Tagen`, `von Montag bis Freitag`, `vom 3.10. bis 18.10.`, `alle 2 Wochen`. English examples: `today`, `tomorrow`, `Friday`, `next Friday`, `until Friday`, `7 Oct`, `03/10/2026`, `in 2 weeks`, `in three days`, `from Monday to Friday`, `from 3 Oct to 18 Oct`, `every 2 weeks`.

Default start is today. A single mentioned date is the deadline/end. Explicit `from X to Y` / `von X bis Y` supplies both endpoints. For example `Physik lernen von 5.10. bis 10.10.` uses 5–10 October. Numeric dates always use **DD/MM/YYYY or DD.MM.YYYY**, never MM/DD/YYYY.

## 22. Live preview

Show detected values while typing, for example `[today] [English] [Homework] [due Fri]`. Keep it compact and understandable before Enter. Missing area/project requires an inline picker or local Inbox draft. Only a valid pair permits saving to Notion.

## 23. Context defaults

A current project/area may supply defaults. In project Englisch, `Make Presentation until Friday` can use that project and infer its unique area. Explicit alternative assignments must still be respected and validated.

## 24. Matching confidence

Combine normalization, case-insensitive matching, aliases, word boundaries, conservative fuzzy matching, relations and current context. Only high-confidence matches may be applied automatically; do not guess aggressively.

## 25. Optional LLM fallback

The app must work without AI credentials. Optional configuration: `GEMINI_API_KEY` and `GEMINI_MODEL=gemini-3.5-flash-lite`. Use fallback only when deterministic interpretation is insufficient, for example `Need to finally get that English presentation done for homework before school on Monday`. Send only necessary task input, allowed area/project/tag context and today's date. Require strict structured JSON, validate it with Zod, and never invent areas/projects or save an invalid response. Offer manual correction. Original illustrative response fields were title, projectId, areaId, startDate, endDate and confidence; see [current Gemini contracts](GEMINI.md) for the implemented schema.

## 26. Navigation

Desktop sidebar: brand/add, search, Inbox, Overview, Today, Next 7 Days, Upcoming, Anytime and Someday; collapsible Areas/Projects; tags; filters; external GitHub/Contact. Display meaningful counts. Example trees include Hausaufgaben (Englisch, Mathematik, Physik), Web Development (TÆSKS, Portfolio, HealthSync) and Homelab (SchulPlaner, Paperless Chat). Main tasks belong in content; optional project expansion must not overload the sidebar.

## 27. Overview

Provide a dense working view with overdue, today, daily highlight, Inbox sources/drafts and upcoming items. Avoid KPI/statistic cards. Show compact title, assignment and date metadata.

## 28. Today

A task belongs when its range includes today: `start <= today` and `(end is null OR end >= today)`. Keep incomplete overdue tasks (`end < today`) visible above current work.

## 29. Next 7 Days

Use interval overlap with `[today, today + 7 days]`, not merely endpoint membership. A task spanning the whole window belongs even if neither endpoint starts within it.

## 30. Upcoming

Show future work beyond the next-seven-days window, grouped compactly by week, month or appropriate dates.

## 31. Anytime

Show active tasks without a real deadline, such as a start with no end, following the actual Notion data.

## 32. Someday

Someday is an explicit local metadata flag. Exclude those tasks from normal active views while retaining their Notion association.

## 33. Highlight

Use Notion's real Highlight checkbox. Emphasize daily highlights within Today/Overview without oversized cards, for example `[*] Finish TÆSKS parser`.

## 34. Project view

Use compact contextual navigation, task lists with inline deadlines, optional groups, add task, Someday, Markdown notes, GitHub context and attachments. Original examples included Build parser, Add GitHub integration, Contact Inbox, PostgREST integration and Health route. Keep TÆSKS visual styling rather than imitating Notion.

## 35. Area view

Show the area name/type, projects, open tasks and progress. An area may contain multiple projects. Original school examples remain user vocabulary rather than translation targets.

## 36. Search

Ctrl/Cmd+K searches tasks, projects, areas, notes, tags, attachment metadata, GitHub repositories/issues/pull requests and Contact submissions. Group results by source and support keyboard navigation. Current loading/search limits are documented separately.

## 37. Keyboard interaction

Suggested shortcuts: Ctrl/Cmd+K search, N Quick Add, Escape close, Enter confirm, arrows/J/K list navigation, Space/X completion when focus is unambiguous, E edit and ? help. Never disrupt ordinary input typing.

## 38. Common Inbox

Combine local drafts/unresolved captures, unread Contact submissions, GitHub review requests and relevant issues/actionable items while distinguishing their source. External items never become tasks automatically.

## 39. External item → task

An explicit Create Task action opens title, area, project, start, deadline and optional tags. After confirmed creation, store source, external ID and Notion task ID in `external_item_links`, then show the confirmed state. Preserve conversion safety.

## 40. GitHub boundary

Use a server-only fine-grained PAT (`GITHUB_TOKEN`, optional `GITHUB_USERNAME`). Read repositories, issues, pull requests, reviews, workflow runs and commits. Never close issues, merge PRs, post comments or alter branches. Creating a separate Notion task from an external item is allowed only through the explicit user flow.

## 41. GitHub view

Present compact repository, review, issue and workflow sections with meaningful success/failure/running states. Follow TÆSKS styling rather than copying GitHub's website.

## 42. Project/repository mapping

Store a local Notion-project ↔ GitHub-repository association in SQLite, e.g. TÆSKS ↔ `username/taesks`. Project context may display its PRs, issues and workflow activity.

## 43. Separate Contact service

The existing external Compose stack must not be changed, merged into this app or assumed to share its Docker network. Original address: `http://192.168.2.173:1917`, configurable by `CONTACT_API_BASE_URL`. It exposes PostgREST over PostgreSQL at `/contact_submissions`, with fields `id`, `site_origin`, `name`, `email`, `message`, `created_at`, `is_read`. Original example timestamp: `2026-08-20T16:43:03.341348+00:00`.

## 44. Contact architecture

Only the TÆSKS server calls PostgREST. Browser → TÆSKS server → PostgREST → PostgreSQL. Do not call the service directly from the browser or invent a browser CORS workaround.

## 45. Contact operations

Where external permissions allow: list, sort, filter, show unread counts, mark read/unread, confirmed delete and explicit create-task conversion. Example GET: `/contact_submissions?order=created_at.desc`; unread filter: `is_read=eq.false`. PATCH `/contact_submissions?id=eq.1` with `{"is_read":true}` or false; DELETE the same item only after confirmation. Disallowed operations produce honest errors.

## 46. Contact view

Use a compact desktop list with detail alongside; show sender, email, site, received time, message and create-task/read/delete actions. A mailto link is optional; do not imply a working email integration.

## 47. Contact security

Treat every message as untrusted text. Escape content, validate URLs and avoid raw HTML/scripts/unsafe HTML injection. Optional `CONTACT_API_AUTH_HEADER` supports server credentials, with anonymous operation when appropriate. Document external API protection. Never automatically alter the Contact stack.

## 48. Tags

Local tags such as bug, calls, prep, school, waiting and research support filtering, searching, adding/removing and multiple tags per task.

## 49. Priority

Local values: None, Low, Medium, High, Urgent. Optional Quick Add syntax includes `!`, `!!`, `!!!`, `urgent`, `high priority` and `dringend`. Avoid misreading ordinary prose/punctuation.

## 50. Saved filters

Persist combinations of area, project, tag, priority, dates, Highlight, Someday and completion. Examples: Urgent, High Priority, Waiting, School and Development.

## 51. Reminders

First provide reliable reminder metadata, in-app reminders and browser notifications with permission. Only offer real self-hosted Web Push when worker, VAPID, subscriptions and SQLite storage are implemented. Document browser/background-delivery limits honestly; do not fake delivery.

## 52. Recurrence

Support daily/weekly/every-two-weeks/monthly rules, including `every 2 weeks` / `alle 2 Wochen`. Completion may create the next Notion instance with area, project, tags, priority and correctly advanced dates. Prevent duplicate creation.

## 53. Mobile UX

Follow compact iPhone references and hierarchical navigation. Prefer headers such as `< lists $ TÆSKS [edit]` or `< overview $ English [...]` over an oversized five-tab bottom bar. Use screen space effectively without card-heavy layouts.

## 54. Desktop UX

Provide persistent sidebar, main content and an optional right inspector for meaningful task-detail work. Do not waste space on an empty permanent inspector.

## 55. Responsive behavior

Desktop sidebar stays visible; tablet sidebar can collapse; mobile uses a lists screen/drawer. Task details may use a page or sheet. Quick Add remains easy to reach.

## 56. PWA

Provide branded manifest/icons, theme colors, standalone display, responsive viewport and an appropriate service worker. At minimum, previously loaded shell/content should be readable offline and capture drafts retained locally. Offline external writes must never appear confirmed.

## 57. Command palette

Ctrl/Cmd+K can combine search results and commands: new task, Inbox/Today/project/area/GitHub/Contact navigation, theme, Settings and refresh.

## 58. Settings and diagnostics

Use a compact view for Notion/GitHub/Contact/local health, actionable failures, property mappings, parser aliases, project/repository mappings, theme and optional LLM status. Never display secrets or confuse configured state with a tested connection.

## 59. Schema diagnostics

On startup or explicit refresh, check all three sources, required properties and relation targets. Explain missing names/types and detected alternatives; do not show cryptic raw API failures.

## 60. Refresh strategy

Use server caching, query invalidation, manual refresh and reasonable stale times. Never reread entire databases per keystroke. Invalidate relevant reads after mutations.

## 61. Loading states

Use subtle skeletons, inline status and text placeholders matching the terminal style, without dominant spinners.

## 62. Error states

Use concise integration status, last-success information and retry actions. The original mockup included a Contact service address; current diagnostics must follow the stricter source-specific privacy contracts. Never display stack traces or secrets.

## 63. Empty states

Keep them minimal, such as `today // nothing here.` or `inbox 0 // you're clear.` Avoid large illustrations.

## 64. Accessibility

Use semantic HTML, keyboard navigation, visible focus, appropriate ARIA, sufficient contrast, accessible labels and reduced-motion support despite the terminal aesthetic.

## 65. Performance

Quick Add must feel immediate. Parse locally/deterministically first, do not call AI while typing, debounce only required external operations, avoid redundant renders and consider virtualization for large lists.

## 66. Motion

Use precise subtle 120–200 ms opacity/translation/height/focus transitions. Avoid bounce, large springs and exaggerated page transitions. Later documented component timings may differ.

## 67. Security

Keep NOTION_TOKEN, GITHUB_TOKEN, GEMINI_API_KEY, Contact credentials and the VAPID private key server-only, never `NEXT_PUBLIC_*`. Validate mutations with schemas. Bound uploads, inspect MIME information, sanitize filenames and prevent traversal.

## 68. Environment reference

Provide complete `.env.example` with PORT=3000, DATA_DIR=/app/data, required Notion IDs/token/property mappings, GitHub credentials, Contact base URL/header, optional Gemini key/model and VAPID public/private keys/subject. Current additional variables and precise defaults are in [`.env.example`](../.env.example); do not copy credentials into documentation.

## 69. Compose

Use container `taesks`, build context `.`, restart unless-stopped, runtime env file, `2015:3000`, persistent `/app/data` and a health check. The original sketch used `./data:/app/data`; current Compose uses the named volume documented in [deployment](DEPLOYMENT.md). No contact_api/postgres/redis service dependencies or required new Docker networks.

## 70. Health

`GET /api/health` reports app/local database health plus safe integration status. Optional integrations may be disabled or temporarily unavailable without making the container unhealthy. The application and local database govern container health.

## 71. Tests

Cover German/English date parsing, numeric ambiguity, English/German ranges, aliases, project/area matching and relations, interval overlap, Today/Next 7 Days, capture integration, mocked Notion/Contact/GitHub adapters and central browser flows.

## 72. Required parser examples

`Make Presentation in English as Homework until the 10/10/2026` should resolve title Make Presentation, project Englisch and area Hausaufgaben when aliases exist, start=current day, end=2026-10-10. Also test the German presentation example, `Physics homework tomorrow`, `Physik lernen von Montag bis Freitag`, `Study physics from 5 Oct to 10 Oct` and `Fix API #TÆSKS @WebDevelopment until next Monday`.

## 73. Timezone

The original user's default is Germany: `APP_TIMEZONE=Europe/Berlin`. Today/heute must use that zone, avoiding UTC day shifts.

## 74. Date display

Compact English/terminal-style dates such as `sat oct 3` / `fri oct 9`, or localized equivalents, are acceptable. Store ISO calendar dates internally. German and English parsing is independent of UI language.

## 75. Localization

The original brief allowed an initial English interface and required German/English parsing with extensible localization architecture. Current source-aware catalogs and English-first selection are described in [the catalog specification](language-catalogs.md).

## 76. Inbox details

Distinguish Contact, GitHub and Draft groups. Contact actions: open/create task/read; GitHub: open/create task; drafts: complete fields/delete. Show relevant message/repository/assignment context without treating external items as tasks.

## 77. Task rows

Compact completion control, title, tags and inline assignment/date metadata. Example: `[ ] Make Presentation [school]`, with `English · Homework · today → fri`. Show deadline/overdue context and subtly mute completed rows.

## 78. Project trees

Use CSS tree lines rather than image assets. Example user vocabulary: Hausaufgaben → Englisch/Physik/Mathematik and Homelab → SchulPlaner/Paperless Chat/Habit Tracker.

## 79. Counts

Right-align counts, e.g. Inbox 3, Today 7, Next 7 Days 12, TÆSKS 7 and Portfolio 3. Count open/relevant items where meaningful.

## 80. Deletion

Confirm Notion task, Contact submission and local attachment deletion using consistent branded dialogs, not browser-native `confirm()`.

## 81. Manual sync

Offer Refresh Data through a button/palette or R shortcut, with compact sync age and no permanent dominant spinner.

## 82. Logging

Use structured server logs with source, operation, status and correlation ID. Never log secrets or full authorization headers.

## 83. README

Document product purpose, architecture/design, requirements, environment/Notion relations, GitHub permissions, separate Contact service, Docker/Compose/port 2015, persistence, `/app/data` backups, troubleshooting, security, optional AI and health. Essential operational detail may live in linked guides.

## 84. Preserve the Contact stack

The separate historical architecture was contact_db (PostgreSQL 16) and contact_api (PostgREST), host port 1917. TÆSKS accesses it server-side through CONTACT_API_BASE_URL. Do not change that Compose stack or require a shared/new Docker network.

## 85. Original definition of done

The original checklist required: running Next.js; clean TypeScript/lint/production build; built image/running healthy container on 2015; migrations and restart persistence; dark/light, mobile/desktop, sidebar/tree/project views; Notion read/create/edit/complete/delete and validated relations; Quick Add, both parser languages, ranges, live preview and optional AI working or disabled; Today, Overdue, Next 7 Days overlap, Upcoming, Anytime, Someday, Highlight; tags, priority, notes, files, filters, search/palette; read-only GitHub with server-only token; server-proxied Contact listing/read/unread/delete where authorized; Contact/GitHub task conversion and repository mapping; complete docs/env examples; no committed secrets; meaningful parser/integration tests. This checklist is a requirement record, not a statement that live services were verified.

## 86. Missing credentials

Build/start/health/setup must work without real API keys. Show not configured/unavailable states. Do not populate production with fake tasks. Targeted test fixtures are allowed in isolated development tests.

## 87. No placeholder end product

Do not substitute TODOs, fake buttons, static demos, disconnected UI, unused APIs or an untested Dockerfile for implementation. Verify external limitations, handle them, document them and disable unavailable actions honestly.

## 88. Original implementation phases

Proceed sequentially through architecture, design/shell, SQLite, Notion, entity tree, CRUD, parser, Quick Add, views, notes/tags/files/filters, GitHub, Contact, search/palette/shortcuts, PWA/mobile, Docker and final QA. Verify each phase before the next.

## 89. Reference material

The original brief expected images/videos showing init.Tasks feature overview, Markdown, mobile Overview, Someday, sidebar/lists, project detail and the user's real three Notion databases. Inspect spacing, hierarchy, trees, fonts, inline comments, dates/colors, density, mobile headers, rows, projects, notes/files and Quick Add. Retain a distinct TÆSKS identity. This document does not imply those attachments are currently available.

## 90. Product vision

A personal task operating system: Notion provides task structure, TÆSKS the working interface, GitHub development context, Contact incoming messages and SQLite local additions. Capture → understand → area → project → task → act. One thought should resolve into an editable task while projects, areas, notes, files, source context and planning remain accessible in one application.

## 91. Original delivery instruction

The original request began from an empty folder, called for an internal plan and sequential specialist phases, and allowed small technical decisions without changing fundamental requirements. Ask only for decisions that cannot be derived from the brief, references, checkout or actual schemas. Test the result; prove an image/container works or identify a concrete external blocker. Report architecture, features, Docker command/port, configuration, external prerequisites and checks. For later work, current authorization and verification reports take precedence over these historical deployment instructions.
