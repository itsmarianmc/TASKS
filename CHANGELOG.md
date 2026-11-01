# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-11-01

### Added
- Added configurable language catalogs with English fallback, German translations, persistent language selection, and localized interface, dates, and reminder text. Catalog configuration and schemas are documented in `docs/language-catalogs.md`.
- Added localized relative-date phrase catalogs, including English and German examples and support for validated custom phrases.
- Added an Undo action for task completion and reopening, including pending mutations and error handling. Undo restores the completion state; it does not remove recurring tasks already created.
- Added a parser preference to treat quoted text as literal, enabled by default, protecting dates, relations, tags, priority, and recurrence from interpretation.
- Added arrival animations for tasks newly received through a manual refresh, with reduced-motion support.

### Changed
- Reworked task date and context display with localized date chips and separate area and project chips.
- Validated and cached remotely configured catalogs on the server, with bounded requests, diagnostics, and safe fallback when catalogs are unavailable or invalid.
- Updated the startup transition and blocked workspace keyboard shortcuts until the startup screen has finished.

### Fixed
- Preserved the last valid task date while a native date field contains a partial or invalid draft, and allowed intentional clearing.
- Improved relative-date parsing for localized weekdays, week modifiers, and durations while preserving calendar and timezone validation.

## [1.0.1] - 2026-10-17

### Fixed
- The startup screen now keeps zooming as it fades out and disappears before the background fade completes, removing the visible pause at the end of the transition.

## [1.0.0] - 2026-10-14

Initial Commit
