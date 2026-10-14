# TÆSKS design and context pass

## Audit — 4 October 2026

All six supplied images depict init.Tasks reference material. The current TÆSKS implementation was inspected in the running application on port 2015 and in its existing components before changes were made.

| Current | Target / implemented |
| --- | --- |
| 234 px sidebar, 11 px navigation, 9 px task metadata | 268 px sidebar (250 px on narrower desktop), 13 px navigation, 11–12 px metadata |
| Main content capped at 1110 px and centered with auto margins | Content aligned beside sidebar with 32–48 px padding; wider source views on large screens |
| 58 px header and tiny breadcrumbs | 48 px desktop header and readable 13 px breadcrumbs |
| Projects indented but without connecting lines | Subtle CSS tree branches, contextual parent emphasis, subdued selected row |
| Project identity and counts based only on Project ID | Area + Project identity across selection, counts, task lists, completed/Someday and capture |
| Date information far from titles | Flat bracket-checkbox task rows with inline metadata underneath |
| Repeated assignment names inside project task rows | Assignment already expressed by the project header; concise task metadata |
| Large generic project empty state | tasks 0, short comment, [+ task], then resources |
| Full-width native repository field | Searchable command-style repository list and compact compatible select |
| Inbox message opens a modal | Desktop list and Contact inspector; mobile detail surface with back navigation |
| Mobile sidebar dialog and obstructing capture button | Full-viewport list screen, parent navigation and header plus / inline task actions |
| Predominantly black/green layers | Blue-black dark layers, warm neutral light layers, semantic deadline/error/link/GitHub colors |

The architecture, adapters, database schema, environment files, Docker setup, upload storage and PWA implementation are retained. No packages were added.

## View URLs and compatibility

The existing single-page workspace now uses explicit query routes, for example:

`/?view=project&project=religion&area=presentations`

Both IDs are serialized and restored. Native History API navigation supports Back/Forward without reloading the workspace. Direct loads read the same parameters using the installed Next.js asynchronous searchParams contract. Existing `project:ID` preferences and `?view=project:ID` links remain readable. Single-area projects resolve their context; multi-area legacy project views ask which area to open instead of silently mixing tasks.

Sidebar rows preserve duplicate project appearances and compare full contextual view keys. The same selector supplies project counts, lists and completed/Someday sections. Quick Add supplies both defaults to the existing parser, which still respects explicit assignments and validates conflicts.

For multi-area project resources, length-prefixed local entity keys distinguish contexts without changing the SQLite schema. Existing globally keyed project notes, links and files remain under an explicitly labeled shared resources disclosure. Single-area projects continue using their existing resource keys.

## Verification

New unit coverage uses Bücher / Religion and Präsentationen / Religion and checks identity, filtered tasks, counts, Someday, URL serialization, capture defaults/explicit overrides and distinct resource keys. New browser coverage checks selected sidebar rows, parent context, counts, actual capture request bodies, direct URL reload, Back/Forward, legacy URLs and full-width mobile lists.

Screenshot QA covers 390×844, 430×932, 768×1024, 1366×768, 1440×900, 1920×1080 and 2560×1440; verifies no horizontal overflow and desktop alignment/font size; captures Inbox, Overview, Today, Area, Project, GitHub, Contact, Quick Add and mobile lists, with central Light Mode views. Fixture screenshots are explicitly synthetic upstream data and never inserted into production.

Existing date grouping expectations were updated to reflect the intentional Upcoming month grouping. The Contact Inbox test now targets its embedded inspector instead of the former dialog. Existing assertions and tests were retained; their common fixture was extracted for reuse.

## Final evidence — 4 October 2026

- All **265 unit/integration tests in 18 files** passed (261 existing cases plus four new context cases).
- TypeScript and ESLint passed. Local optimized production build passed. Docker production build passed.
- All **68 Playwright cases in five files** passed against the isolated production Docker container on port 2016: 62 existing cases plus six new desktop/mobile cases. The final run result is `test-results/design-final/.last-run.json`, with `status: passed` and no failed tests. No existing test was deleted.
- All seven requested viewport sizes passed overflow checks. Dark and Light fixture screenshots were visually inspected; subsequent live screenshots cover the real application before and after deployment, including both appearance variants.
- The installed Next.js guides for linking/navigation, global CSS and asynchronous page searchParams were read before implementation.
- Productive container `taesks` was recreated using the **same image tested in QA**: `sha256:cf37513a5c5d67fe0335aaf271b48090d660772d9c6f0ff6092d3c6eaedb4020`. Compose completed successfully with **healthy** status, port **2015:3000**, user **1001:1001**, original **taesks_data:/app/data** mount.
- Actual `/api/health` returned `status: ok` and `localDatabase: ok`. Actual Notion reads returned **12 Areas / 19 Projects / 60 Tasks**, with successful diagnostics; GitHub returned **42 repositories**, status `ok`; Contact returned **1 total / 1 unread**, status `ok`.
- `.env`, SQLite schema, existing source records and production uploads were retained. Live screenshot navigation changed only reversible preferences, which were restored afterward. No live task/contact mutation or GitHub write was issued.
- The uniquely labeled temporary QA container and its verified QA volume were removed after production health was confirmed. The production container remains running.

The first development browser run was stopped after an obsolete Upcoming day-heading assertion was identified. It was updated to the intentional month heading. A complete subsequent production-container run passed all 68 cases. Mobile verification uses Chromium viewport/touch emulation; physical Safari/iOS remains outside this evidence.

See `DESIGN-SCREENSHOTS.md` for live comparisons and the complete screenshot inventory.
