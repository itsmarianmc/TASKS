# Catalog and task interaction implementation report

Implemented central validated server catalogs and locale selection, a shared typed translation context with bundled English fallback, data-driven DE/EN/custom date phrases, literal quotation preferences, manual-refresh arrivals, serialized completion/reopening Undo, and validated native date drafts. Existing user changes were integrated and retained. No real environment values, credentials, deployments, commits, or external data were changed.

Configuration and both v1 schemas are documented in [language-catalogs.md](language-catalogs.md), with variables in [.env.example](../.env.example). The bundled English catalog is the complete translation-key reference. Generic reminder copy stays free of task titles/notes.

## Verification

- Focused unit suites: 19 files, 283 affected tests passed across the focused and final full-suite runs. This includes the existing parser/relative-date tests, catalog loading/validation/fallback, server rendering, quotes, date drafts, completion sequencing, refresh IDs, preferences, optimistic state, task service, and worker behavior.
- Full unit run: 534 passed, 4 failed (538 total). Failures are in unchanged Contact, GitHub and Notion adapters/tests: stale-cache refresh expectations (Contact/GitHub), unavailable versus conflicting relations (Notion), and stale graph completion availability (Notion). No changes were made to those adapter implementations or tests.
- Browser regressions: 68 distinct cases passed across desktop/mobile runs: 16 new catalog/interaction cases and 52 existing core, project-relation and responsive-detail cases. The final date-clearing persistence assertion also passed on both profiles. Earlier fixture failures were corrected by waiting for startup and collapsing the mobile sidebar through its visible control. The default Playwright origin now uses `localhost`, matching Next.js development-origin checks.
- `npm run typecheck`, `npm run lint`, and `git diff --check`: passed.
- `npm run build -- --webpack`: passed, including Next.js generated route-handler type checks and production page generation. Integrations/catalog URLs were disabled through process environment overrides and data used isolated test storage.
- Default `npm run build` (Turbopack): failed before compilation completed because its CSS subprocess exited before connecting, inside and outside the sandbox. The default bundler configuration was not changed.

## Public locale files follow-up

The canonical catalogs now live in `public/locales/en` and `public/locales/de`, each with `language.json` and `date-phrases.json`. German UI translations have the same 1,910 keys and placeholders as English. Bundled imports, test paths, and documentation point to these files. The focused catalog, translation, parser and worker checks passed 145 tests; TypeScript, focused ESLint and diff checks passed.

## Limitations

Remote catalogs were verified with synthetic HTTP responses, including unavailable URLs, timeout and size failures. No user-hosted catalog URLs or live integrations were exercised. Playwright uses headless Edge on desktop and Chromium mobile emulation, rather than physical iOS/Android devices. Native date-picker appearance and segmented keyboard behavior come from the browser/OS. Unknown third-party diagnostic prose remains as received. Undo restores the completion flag; recurring tasks already created through the existing server ledger remain intact.

## Files changed or integrated for this implementation

This list excludes files that only contained pre-existing user changes. `src/components/date-chips.tsx` was already present as untracked user work and was extended for translated, validated dates.

- [`.env.example`](../.env.example)
- [`README.md`](../README.md)
- [`docs/language-catalogs.md`](../docs/language-catalogs.md)
- [`public/service-worker.js`](../public/service-worker.js)
- [`src/app/api/config/route.ts`](../src/app/api/config/route.ts)
- [`src/app/api/parse/route.ts`](../src/app/api/parse/route.ts)
- [`src/app/globals.css`](../src/app/globals.css)
- [`src/app/layout.tsx`](../src/app/layout.tsx)
- [`src/app/page.tsx`](../src/app/page.tsx)
- [`src/app/providers.tsx`](../src/app/providers.tsx)
- [`src/app/sw.js/route.ts`](../src/app/sw.js/route.ts)
- [`src/components/app-shell.tsx`](../src/components/app-shell.tsx)
- [`src/components/capture.tsx`](../src/components/capture.tsx)
- [`src/components/command-palette.tsx`](../src/components/command-palette.tsx)
- [`src/components/completion-feedback.tsx`](../src/components/completion-feedback.tsx)
- [`src/components/contact.tsx`](../src/components/contact.tsx)
- [`src/components/date-chips.tsx`](../src/components/date-chips.tsx)
- [`src/components/date-input.tsx`](../src/components/date-input.tsx)
- [`src/components/display-controls.tsx`](../src/components/display-controls.tsx)
- [`src/components/entity-panel.tsx`](../src/components/entity-panel.tsx)
- [`src/components/github.tsx`](../src/components/github.tsx)
- [`src/components/localization.tsx`](../src/components/localization.tsx)
- [`src/components/mutation-status.tsx`](../src/components/mutation-status.tsx)
- [`src/components/navigation.tsx`](../src/components/navigation.tsx)
- [`src/components/notion-settings.tsx`](../src/components/notion-settings.tsx)
- [`src/components/primitives.tsx`](../src/components/primitives.tsx)
- [`src/components/pwa.tsx`](../src/components/pwa.tsx)
- [`src/components/reminders.tsx`](../src/components/reminders.tsx)
- [`src/components/settings.tsx`](../src/components/settings.tsx)
- [`src/components/startup-loader.tsx`](../src/components/startup-loader.tsx)
- [`src/components/task-detail.tsx`](../src/components/task-detail.tsx)
- [`src/components/task-fields.tsx`](../src/components/task-fields.tsx)
- [`src/components/task-row.tsx`](../src/components/task-row.tsx)
- [`src/components/terminal-toggle.tsx`](../src/components/terminal-toggle.tsx)
- [`src/lib/calendar.ts`](../src/lib/calendar.ts)
- [`public/locales/de/date-phrases.json`](../public/locales/de/date-phrases.json)
- [`public/locales/de/language.json`](../public/locales/de/language.json)
- [`public/locales/en/date-phrases.json`](../public/locales/en/date-phrases.json)
- [`public/locales/en/language.json`](../public/locales/en/language.json)
- [`src/lib/catalogs.ts`](../src/lib/catalogs.ts)
- [`src/lib/completion-queries.ts`](../src/lib/completion-queries.ts)
- [`src/lib/completion.ts`](../src/lib/completion.ts)
- [`src/lib/date-phrases.ts`](../src/lib/date-phrases.ts)
- [`src/lib/parser-dates.ts`](../src/lib/parser-dates.ts)
- [`src/lib/parser.ts`](../src/lib/parser.ts)
- [`src/lib/public-config.ts`](../src/lib/public-config.ts)
- [`src/lib/queries.ts`](../src/lib/queries.ts)
- [`src/lib/refresh-arrivals.ts`](../src/lib/refresh-arrivals.ts)
- [`src/lib/schemas.ts`](../src/lib/schemas.ts)
- [`src/lib/server/ai/fallback.ts`](../src/lib/server/ai/fallback.ts)
- [`src/lib/server/catalogs.ts`](../src/lib/server/catalogs.ts)
- [`src/lib/server/config.ts`](../src/lib/server/config.ts)
- [`src/lib/server/repository.ts`](../src/lib/server/repository.ts)
- [`src/lib/translation.ts`](../src/lib/translation.ts)
- [`src/lib/types.ts`](../src/lib/types.ts)
- [`src/lib/views.ts`](../src/lib/views.ts)
- [`tests/catalogs.test.ts`](../tests/catalogs.test.ts)
- [`tests/completion.test.ts`](../tests/completion.test.ts)
- [`tests/date-input.test.ts`](../tests/date-input.test.ts)
- [`tests/e2e/catalog-interactions.spec.ts`](../tests/e2e/catalog-interactions.spec.ts)
- [`tests/e2e/core.spec.ts`](../tests/e2e/core.spec.ts)
- [`tests/e2e/task-detail-responsive.spec.ts`](../tests/e2e/task-detail-responsive.spec.ts)
- [`tests/e2e/workspace.fixture.ts`](../tests/e2e/workspace.fixture.ts)
- [`tests/parse-route.test.ts`](../tests/parse-route.test.ts)
- [`tests/parsing-catalogs.test.ts`](../tests/parsing-catalogs.test.ts)
- [`tests/refresh-arrivals.test.ts`](../tests/refresh-arrivals.test.ts)
- [`tests/repository.test.ts`](../tests/repository.test.ts)
- [`tests/translation-render.test.ts`](../tests/translation-render.test.ts)
- [`tests/worker-localization.test.ts`](../tests/worker-localization.test.ts)
- [`docs/catalog-implementation-report.md`](../docs/catalog-implementation-report.md)
- [`next-env.d.ts`](../next-env.d.ts) — generated production type references from Next.js build.
- [`playwright.config.ts`](../playwright.config.ts)
