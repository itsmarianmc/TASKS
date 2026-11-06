# Task visibility, Quick Add and inspector — 4 October 2026

This pass changes the existing TÆSKS application. Its adapters, task model, optimistic mutation journal, data volume and design language are retained.

## Behavior

- `übernächsten Freitag` and `über nächsten Freitag`, inflections, capitalization, decomposed Unicode, flexible whitespace and terminal punctuation resolve deterministically. From 2026-10-04 in Europe/Berlin the deadline is 2026-10-16. The full connecting phrase, including `bis zum`, is removed from the title. All seven weekdays, the week after next and the weekend after next are covered. Existing bare/next weekday rules remain intact.
- `Präsentation in Englisch bis übernächsten Freitag als Hausaufgabe` resolves to **Präsentation**, **Englisch**, **Hausaufgaben**, **2026-10-04 → 2026-10-16** without Gemini. The singular school category is recognized against the existing plural area name without requiring a manually configured alias.
- `showCompletedTasks` defaults to true. `hideProjectsWithoutCurrentTasks` defaults to false. Settings → display and the compact Overview controls update the same optimistic SQLite preference state. Failed preference writes retain the session choice and offer existing error/retry feedback.
- Completed tasks use `[✓]` and accessible checkbox semantics. They appear after open tasks in a visible completed section. Today, Next 7 days and Upcoming retain their date scopes; the existing open overdue queue is retained. Completed overdue history does not join Today. Unbounded entity/tag/Anytime/Someday lists use `RECENT_COMPLETED_DAYS = 7`. Explicit saved completed/open criteria override the global choice; date filters retain their date range. Search remains independent of both display settings.
- SQLite migration 4 adds nullable `task_metadata.completed_at`. Completion records a timestamp; reopening clears it. Existing timestamps survive repeated completion acknowledgements. The optimistic graph and local metadata change together and roll back together on failure. Historical completed tasks whose completion date is unknown are not assigned an invented recent date; scheduled views can still display them within their dates.
- Sidebar filtering uses existing open/actionable counts for each Area + Project combination. Completing the last task retains the active zero-count project until navigation. Empty areas are hidden unless active or needed for their own actionable tasks. Search, direct URLs and the Area project index continue to expose all projects.
- The inspector uses a 440 px right drawer on desktop and full width on mobile, with 220 ms entry and 200 ms exit. Radix retains it through exit, handles Escape and supports reduced motion. Desktop task switching preserves the drawer surface. Dates display `DD.MM.YYYY`; Quick Add displays compact German dates, retaining ISO values internally.
- Highlight and Someday share terminal toggles. Core edits save after 500 ms idle, leaving the fields, closing or switching tasks. Highlight changes immediately; local priority, tags, recurrence and Someday remain optimistic; reminders save when leaving their field. Failed edits retain the existing device draft. The task and scheduling Save buttons are removed.
- Exact command-palette matches take precedence over substring matches, avoiding Work/Homework context confusion. Mutation feedback does not cover desktop drawer actions; mobile drawer scrolling reserves space for it.

## Verification

The installed Next.js client-component guide was read before implementation. Existing Quick Add/Overview/tree screenshots and the documented init.Tasks reference audit informed the visual changes.

TypeScript, ESLint and **416 unit/integration tests across 24 files** pass. Native Windows production build and Linux Docker production build pass. All **128 production browser test cases** have passed on desktop and mobile: the full run passed 127; one failure-injection test also intercepted a pending last-view preference write, producing two expected error messages. Its interception was narrowed to the display preference, and the complete affected suite passed **12/12** on rerun. TypeScript and the changed test's lint check also passed afterward.

The tested image (`sha256:32fb8f92869f65a4ec28fd8ba19fa86a7f4a839c5271dd9a784393799ec1a5d5`) now runs in the existing local `taesks` container at **http://localhost:2015**, with the original `taesks_data` volume and configuration. Container health is **healthy**, the application returns HTTP 200, `/api/health` reports `ok`, and SQLite passes `quick_check` with migrations 1–4 and `completed_at` present. The prior image is retained as `taesks:before-visibility-20261004`. Existing preference values and all pre-update local record counts are preserved (four metadata records; zero notes, attachments, links, drafts, aliases, filters and tags). New preferences return the requested defaults.

A read-only parser preview against the updated app and its real project/area graph returned **Präsentation / Englisch / Hausaufgaben / 2026-10-04 → 2026-10-16**, confidence 1, no warnings and `fallback: "not needed"`. No task was created. The isolated QA container and test volume were removed after verification.

Functional browser checks cover immediate completion and rollback, reopening, delayed writes, temporary task identity, autosave and rapid edits, drawer enter/exit/Escape/switching/reduced motion, preference persistence and retained failed preferences, Area + Project filtering, active zero-count retention, unfiltered search and deterministic German capture. The broader suite also exercises existing integrations, Markdown/files, PWA/offline behavior and responsive light/dark layouts.

Screenshots use synthetic upstream records inside the browser tests. Local persistence/PWA tests use the separate Docker QA volume; existing Notion tasks, Contact records and production local data are not used as mutation fixtures. Mobile coverage uses Edge Chromium with iPhone viewport/touch emulation.

## Screenshots

Historical artifact paths below are retained as an inventory. The captures are not included in this checkout.

| View | Desktop | Mobile |
| --- | --- | --- |
| Quick Add | `../test-results/visibility-screenshots/desktop-quick-add.png` | `../test-results/visibility-screenshots/mobile-quick-add.png` |
| Overview / completed on | `../test-results/visibility-screenshots/desktop-overview-completed-on.png` | `../test-results/visibility-screenshots/mobile-overview-completed-on.png` |
| Overview / completed off | `../test-results/visibility-screenshots/desktop-overview-completed-off.png` | `../test-results/visibility-screenshots/mobile-overview-completed-off.png` |
| Sidebar filter off | `../test-results/visibility-screenshots/desktop-sidebar-filter-off.png` | `../test-results/visibility-screenshots/mobile-sidebar-filter-off.png` |
| Sidebar filter on | `../test-results/visibility-screenshots/desktop-sidebar-filter-on.png` | `../test-results/visibility-screenshots/mobile-filtered-lists.png` |
| Settings / display | `../test-results/visibility-screenshots/desktop-settings-display.png` | `../test-results/visibility-screenshots/mobile-settings-display.png` |
| Open task inspector | `../test-results/visibility-screenshots/desktop-inspector-open.png` | `../test-results/visibility-screenshots/mobile-inspector-open.png` |
| Completed inspector | `../test-results/visibility-screenshots/desktop-inspector-completed.png` | `../test-results/visibility-screenshots/mobile-inspector-completed.png` |
