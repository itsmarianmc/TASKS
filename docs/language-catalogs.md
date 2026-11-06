# Language and date catalogs (schema version 1)

English is the canonical UI source. Every image bundles all valid language pairs found in `public/locales/<language>/`, including English and German. These work without GitHub, external configuration or network access. User data and external content are never translated: task titles, project/area names, notes, tags, messages and configured Notion property names keep their original values.

## Source files and compatibility

Each language folder contains exactly the two required catalog files:

```text
public/locales/en/language.json
public/locales/en/date-phrases.json
public/locales/de/language.json
public/locales/de/date-phrases.json
```

Next.js serves these public files under `/locales/`. The build/dev/test/typecheck hooks run `scripts/generate-catalogs.mjs`, which scans actual folders, validates pairs and generates `src/lib/generated/bundled-catalogs.json`. Translators never maintain a manifest. The generated JSON is imported into the standalone server; it is ignored by Git and regenerated before builds. Runtime refresh maintains a separate JSON-compatible in-memory index of discovered languages and repository revision. Neither index requires writes to the running application filesystem.

Both catalogs must validate against the running image's schemas. `schemaVersion` must be `1` (omission remains accepted as legacy v1). `lang` must be a valid BCP 47 tag canonicalized by `Intl.getCanonicalLocales`; both files must match exactly after canonicalization. Repository folder tags must match too. `de` and `de-DE` are distinct. Metadata also requires nonempty `name` (English name) and `locName` (native name), at most 100 characters. Unknown fields and schema versions are rejected. Runtime source metadata is added by the server, never supplied in a catalog.

A UI catalog must contain **all and only the current English keys**, with nonempty plain-text strings and exactly matching placeholder names and occurrences per key. This rejects incomplete or incompatible updates as an entire pair. A response must fit within **256 KiB**; keys are limited to 180 characters using letters, numbers, underscores, dots or hyphens; values to 4,000 characters and the schema to 3,000 keys. Template order may change, but `{p0}` and `{p1}` must remain intact. React escapes interpolated user values. The translator also retains defensive per-key English fallback for malformed client fixtures or legacy data.

For the full key reference, copy [English UI strings](../public/locales/en/language.json) and [English date phrases](../public/locales/en/date-phrases.json). The [translator guide](../CONTRIBUTION.md) covers contribution and testing.

## Repository discovery and refresh

The source is [`itsmarianmc/T-SKS`, branch `main`](https://github.com/itsmarianmc/T-SKS/tree/main/public/locales). The server uses these documented GitHub REST endpoints:

1. `GET https://api.github.com/repos/itsmarianmc/T-SKS/commits/main` obtains the commit SHA.
2. `GET https://api.github.com/repos/itsmarianmc/T-SKS/contents/public/locales?ref=<sha>` lists actual language directories.
3. For each valid language folder, fetch the two known files from `https://raw.githubusercontent.com/itsmarianmc/T-SKS/<sha>/public/locales/<language>/`.

The listing and files use one commit SHA, avoiding mixed revisions. A raw-content URL is never treated as a directory listing. See [GitHub Contents API](https://docs.github.com/en/rest/repos/contents) and [commit endpoint](https://docs.github.com/en/rest/commits/commits#get-a-commit).

The first configuration read returns bundles immediately and starts background discovery. A process timer checks every **30 minutes** while the same server runs; an expired configuration read also starts a deduplicated refresh. The server never requests GitHub on every render. A valid unchanged commit avoids downloading its catalogs again. Failed file validation retries next interval, even if the commit is unchanged. The browser polls `/api/config` every **five minutes** while open and applies compatible catalogs without a page reload. Allow roughly **35 minutes**, plus bounded request time, for an upstream change to reach an open page. Reloading obtains the current server snapshot but does not bypass the server's interval. A background browser tab may need focus or a reload because browser timers can be suspended.

Discovery is unauthenticated and never uses `GITHUB_TOKEN`. GitHub's public API normally permits **60 requests/hour per originating IP**, shared with other clients behind that IP; this design uses at most four discovery API calls/hour per active process after initial discovery. Raw file requests are separate and remain bounded. Rate limits, timeouts, redirects, invalid listings and unavailable GitHub do not block startup or replace a working fallback. The next attempt is after the normal 30-minute interval; no aggressive retry loop is used. See [GitHub rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

The listing/commit response limit is 1 MiB/256 KiB respectively. Discovery accepts at most **32** valid language directories per scan; GitHub's Contents API itself limits directory listings to 1,000 entries. Extra languages receive a safe limit diagnostic. There are at most **four concurrent requests**, a **2.5-second deadline** per response including body consumption, and no credentials or redirect following. Remote requests bypass Next.js fetch caching; the process owns the refresh/cache lifecycle. Every process has an independent cache and timer, so many replicas can share an IP rate limit.

Compatible remote pairs replace repository entries with the same canonical code. Bad updates retain that source's last-good pair; otherwise the bundled pair remains. A removed remote-only folder disappears after a successful listing; bundled languages remain available. All last-good remote state is memory-only and is lost on restart. A restarted image starts from its bundles and rediscovers additions. Repository provenance is **not proof of human review**. Code changes, new keys or incompatible schemas may require rebuilding the image. An image's baked-in files never update themselves.

## External folders: one server-only variable

```dotenv
TRANSLATION_FOLDER_URLS=https://raw.githubusercontent.com/itsmarianmc/T-SKS/main/public/locales/de/, https://raw.githubusercontent.com/itsmarianmc/T-SKS/main/public/locales/en
```

This working folder layout uses the same two source files and needs no directory-listing support. Self-hosted folders work the same way. Setting this example intentionally creates external copies of languages already offered by the repository.

Rules:

- Split on literal commas, trim surrounding whitespace, ignore empty entries and deduplicate identical entries. Encode commas inside URLs as `%2C`.
- Use absolute `http://` or `https://` **folder URLs**. Trailing slashes are optional: all trailing slashes are replaced by one slash, and standard URL resolution appends `language.json` and `date-phrases.json` while preserving the folder path and encoded characters.
- Embedded credentials, query strings, fragments and direct `language.json` / `date-phrases.json` URLs are rejected. Redirects are rejected, including login redirects. Host the actual UTF-8 JSON at the final URLs. Folder endpoints require no listing.
- At most **16 folders**, four concurrent requests, 256 KiB per decoded file and 2.5 seconds per response. Each worker reads its two files sequentially. Both files must be compatible and have identical canonical language codes. If either file is missing, invalid, mismatched or unavailable, the entire new pair is ignored. A previously working pair from that exact folder remains in memory until restart or configuration removal.
- External folders refresh every **30 minutes**, even without rebuilding the running image. Changing environment values still requires container recreation. Only administrators should set server-reachable URLs; remote content is untrusted and credentials are never forwarded.

The browser receives validated strings, native names and opaque source IDs, never configured folder URLs, paths, raw responses or credentials. Settings diagnostics identify source type and position with fixed safe reasons. They never embed remote exception text. External choices are first, prefixed exactly `[!]`, followed by a separately labeled repository group. An accessible explanation says external translations have not been verified by the project. Duplicate external/repository language codes remain independently selectable. Multiple external folders with one code are distinguished by their configuration positions.

## Selection, persistence and migration

**User decisions:** a new user always starts in repository **English**, regardless of browser language. External and repository entries with the same code both appear separately.

Preferences store a source identity: `repo:<canonical-code>` or `external:<opaque-folder-hash>:<canonical-code>`. The external hash is derived from the normalized folder URL, so ordering changes do not change identity; changing the URL does. UI strings, date phrases, SSR, parser requests and service-worker reminder copy resolve the same identity. The document's `lang` remains the actual BCP 47 code. Server configuration is shared within a render to keep hydration consistent. Notification copy stays generic and contains no task titles or notes; changing selection/catalogs asks the worker to update. Existing displayed OS notifications are not rewritten.

Old code-only preferences such as `de` or `DE` resolve to repository German. Their original source cannot be reconstructed, so they never arbitrarily select an external duplicate. The persisted value can remain legacy until the next explicit selection. An unavailable saved source falls back to repository English, retaining the saved identity so it can recover if that exact source returns. It never substitutes another same-code source. Temporary failures with a last-good pair keep that exact pair usable.

### Replace the old variables

`LANGUAGE_JSON_URL` and `SHORT_DATES_JSON_URL` are **ignored**, with a safe migration diagnostic. They are not parsed as folders and have no precedence over the new variable.

For an old pair such as `https://host/translations/de/language.json` and `https://host/translations/de/date-phrases.json`, remove both old variables and set:

```dotenv
TRANSLATION_FOLDER_URLS=https://host/translations/de/
```

Repeat for each folder, separated by commas. If the old files were in different folders or had other names, publish copies at the two required names in one folder first. Recreate the container after updating `.env`. Bundled English and German require no variable at all.

## Date phrase schema and semantics

See the [complete German example](../public/locales/de/date-phrases.json). `phrases` supports `weekStart`, `relativeDays` (`today`, `tomorrow`, `dayAfterTomorrow`, `yesterday`, `dayBeforeYesterday`), `weekdays` (Sunday through Saturday), `nextWeek`, `weekAfterNext`, `nextWeekend`, `weekendAfterNext`, `next`, `afterNext` and `durations` (`prefixes`, `day`, `week`, `month`, `year`, `numbers`). Categories are optional; unknown names are rejected. Missing categories do not imply inferred translation grammar.

Each alias is literal text of 1–100 characters, never executable regex. Supply inflections, abbreviations and transliterations explicitly. Lists allow at most 80 entries; the whole catalog allows 400 aliases/number words. Conflicting standalone aliases invalidate the pair. Duration numbers are integers from 1 to 365. `weekStart` uses JavaScript weekday numbers (`0` Sunday through `6` Saturday), defaulting to the locale's first weekday.

- Relative days use offsets `0`, `+1`, `+2`, `−1`, `−2` from the reference calendar day in `APP_TIMEZONE`.
- `nextWeek` and `weekAfterNext` use the next/following calendar week's start. A weekday with either phrase selects that weekday in that week: `Dienstag übernächste Woche` or `Tuesday the week after next`.
- A standalone weekday can include today. A `next` prefix means the next strictly upcoming occurrence; `afterNext` means the second upcoming occurrence, including on a matching Friday. Weekends mean the next or second upcoming Saturday.
- Duration syntax is prefix + number/number alias + unit, such as `in three days` / `in drei Tagen`. Days/weeks use calendar arithmetic across DST. Months/years retain the day of month and reject nonexistent dates instead of rolling over.
- Long full phrases precede standalone weekdays. Case/NFC matching, calendar validity, relation protection, ranges, conflicting-date warnings and European numeric notation remain. Recognizing yesterday does not permit a standalone past deadline; explicit ranges may have past starts.

The selected source's date data extends the deterministic parser; built-in German and English remain available independently of UI language. No UI string is paired with another folder's date data merely because its code matches.

## Task interaction behavior

“Treat quoted text as literal” defaults on, including old preferences. Straight double quotes, German `„…“` and curly `“…”` protect dates, relations, tags, priority and recurrence. An unmatched opener protects the remainder; apostrophes within words are ordinary text. Disabling it restores quoted-token parsing. AI fallback is skipped for protected input.

Start/deadline fields retain drafts and commit on blur or Enter. Only a valid four-digit-year ISO date or intentional clear enters task state; invalid/partial/five-digit-year values preserve the previous date. Leap-year checks are independent of browser timezone. Native picker appearance is browser/OS controlled.

Manual refresh animates newly received visible IDs once. Initial loads, polling, updates, reordering and navigation do not trigger arrivals. Concurrent refreshes coalesce; reduced motion disables entrance animation.

Completion/reopening uses optimistic mutations with Undo during and after confirmation. Pending Undo waits for the original success, then restores the exact previous completion flag. One lane exists per task. Failed writes never claim success; inverse failures use existing rollback/error feedback. Confirmed toasts expire after eight seconds, except while keyboard focus is inside. Undo does not remove recurring tasks already created by the confirmed server ledger.
