# Mobile interface and startup state — 7 October 2026

This is historical verification for that pass. Later startup sequencing changes are covered in [the current verification report](english-experience-verification.md).

## Confirmed cause

GitHub, Contact and draft notices were inserted above the tasks in Overview after loading. With source responses held back, a visible cached task moved from y=379 to y=483: 104 px. After the change, the same task stayed in place (0 px displacement).

The working copy already displayed graph data during its initial background check. Waiting unconditionally for that request would have delayed cached startup again. The additional layout shift came from composing the view and preparing device drafts/configuration, rather than a need to clear caches.

## Changes in that pass

- `page.tsx`, `queries.ts`, `app-shell.tsx`: pass public configuration from the server, merge device drafts before the first visible workspace and wait for hydration. Use existing graph data immediately. If required startup-view data is missing, wait for a result or error. Keep the shell open afterward.
- `app-shell.tsx`: place late Overview notices and Notion error status below the tasks. Avoid movement on the first workspace display; retain brief motion for later content changes. Preserve History and search.
- `theme.tsx`: apply the saved theme before visible paint.
- `globals.css`: reduce the additional mobile glass reserve from 16 to 8 px and Overview padding from 23 to 16 px. Safe-area values remain additive. Keep header search visible and mobile header buttons at least 40 px.
- Lists: keep the panel mounted, with 220 ms opening / 200 ms closing, matching the task drawer. Enter from the left, with interruptible CSS transitions, focus management and an inert background.
- `command-palette.tsx`, `primitives.tsx`, `globals.css`: enlarge the palette, scroll results and fix the input/header/footer. Mobile height follows the Visual Viewport and leaves safe areas clear.
- `navigation.tsx`, `capture.tsx`, `globals.css`: hide shortcut hints/help on mobile. Retain desktop help and keyboard behavior. Reduced motion disables movement.

## Checks performed then

| Check | Result |
| --- | --- |
| Normal production build with the original Next.js configuration | Passed |
| TypeScript and ESLint for changed TS/TSX files | Passed |
| Focused unit tests: startup, PWA, worker, views, navigation and optimistic state | 60 passed |
| Production browser checks: desktop and smartphone | 17 passed; 1 mobile-only case skipped on desktop |
| Full unit suite | 456 passed; 4 failed |

The four failures were in unchanged adapter tests: `notion.test.ts:282` (RELATION_UNAVAILABLE instead of RELATION_CONFLICT), `notion.test.ts:295` (completionEnabled), `contact.test.ts:12` and `github.test.ts:60` (cached status ok instead of error). Those paths were unchanged.

Browser cases checked cached tasks during delayed/failed refresh, background polling without a new splash, startup without a graph cache, Contact startup after success/failure and a device draft on the first visible offline Inbox. They also covered search in six views, the retained header, Back/Forward, launcher boundaries, rapid list-panel reversal, Escape, inert backgrounds and reduced motion.

Screenshots were checked in Edge/Chromium at 320×568, 390×664, 430×932 and 1280×720. A simulated safe area used 47 px top / 34 px bottom, with header spacing 55 px (=47+8). A 320×300 viewport checked the available keyboard area with visible input and footer.

## Limits and data preservation

Real iOS Safari and installed-PWA tests were unavailable. Chromium simulation does not prove iOS system blur or the physical keyboard behavior. The referenced screenshot was not visible as an attachment in that conversation, so direct comparison was impossible.

All server checks used separate temporary storage and disabled external integrations; browser cases used fixtures. Temporary test configuration was restored. No existing API/PWA caches, SQLite data or device drafts were deleted. No API/schema/integration changes, dependencies or deployment were introduced in that pass.
