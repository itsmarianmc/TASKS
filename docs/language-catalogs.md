# Language and date catalogs (schema version 1)

TÆSKS has a bundled English UI and bundled German/English date phrases. Complete English and German UI catalogs and their date catalogs are stored in `public/locales`. No translation package is required. Task titles, project/area names, notes, tags, source messages, Notion property names, and other user content are never translated.

## Included files

```text
public/locales/
  en/language.json
  en/date-phrases.json
  de/language.json
  de/date-phrases.json
```

Next.js serves these at `/locales/en/language.json`, `/locales/en/date-phrases.json`, `/locales/de/language.json`, and `/locales/de/date-phrases.json`. The bundled English fallback and built-in date parser import these same canonical files. German has the same translation keys and placeholders as English; technical identifiers and brand names stay unchanged where appropriate.

To offer German in Settings, include its absolute, server-reachable URL in `LANGUAGE_JSON_URL`, and include the matching date URL in `SHORT_DATES_JSON_URL`. Use a direct endpoint that the server can read without an interactive login.

## Server configuration

```dotenv
LANGUAGE_JSON_URL=https://example.org/locales/en/language.json, https://example.org/locales/de/language.json
SHORT_DATES_JSON_URL=https://example.org/locales/de/date-phrases.json, https://example.org/locales/en/date-phrases.json
```

Both values are comma-separated lists of **direct HTTP(S) JSON URLs**. Whitespace around each entry and empty entries are ignored. Commas within a URL must be percent-encoded as `%2C`. URLs with embedded credentials and redirects are rejected. These variables stay on the server; the browser receives validated catalogs through the shared configuration flow, never the configured URLs. Restart after changing environment configuration.

There are at most 16 URLs per variable, a 2.5 second timeout per response (including its body), and a 256 KiB decoded response limit. Reads run concurrently and use a deduplicated, five-minute process cache, including failed reads, rather than component-level fetches. Response bodies and URLs are excluded from diagnostics. Settings displays catalog-kind/index or language diagnostics for invalid/unavailable catalogs, duplicates and mismatches. An unavailable host or invalid JSON never prevents a build or startup. In a multi-process deployment each process has its own cache.

## `language.json`

```json
{
  "schemaVersion": 1,
  "lang": "de",
  "name": "German",
  "locName": "Deutsch",
  "strings": {
    "common.undo": "Rückgängig",
    "completion.completed": "Aufgabe erledigt",
    "completion.reopened": "Aufgabe wieder geöffnet"
  }
}
```

`lang` is a valid BCP 47 tag, canonicalized with `Intl.getCanonicalLocales` (`DE-de` becomes `de-DE`). `name` is its English name and `locName` its native name. Both are required, nonempty strings (100 characters maximum). `schemaVersion` must be `1`; omission is accepted as version 1 for the original minimal format. Unknown schema versions/fields are rejected.

`strings` maps stable translation keys to plain strings, not HTML. Keys contain letters, digits, underscores, dots or hyphens (maximum 180 characters); values have a 4,000 character limit and a catalog has at most 3,000 keys, within the response limit. The complete English key/template reference is [`public/locales/en/language.json`](../public/locales/en/language.json). Copy the keys you want to translate; missing keys fall back individually to bundled English. Templates use named placeholders such as `{p0}` and `{p1}`. Preserve their names; a translation with missing/extra placeholders falls back to English. Interpolated titles/names remain data and React escapes rendered text. Some keys represent application messages from services and parser validation, translated at their display boundary. Unrecognized third-party diagnostic text is displayed as received. Generic closed-app reminder copy also comes from `reminders.title` and `reminders.body`; changing language requests a worker update, without adding task titles or notes to push payloads.

Settings → Language lists successful catalogs using `locName`, with a built-in English option when needed for fallback. The selection persists in the existing local preferences store (the same scope as theme/display preferences). On first use TÆSKS uses the browser's ordered `Accept-Language` preferences: exact tag first, then a catalog of the same base language. If none matches, it chooses an English catalog, then built-in English. A saved language takes precedence; if it disappears, English fallback is used safely. Locale and validated catalogs are included in server rendering so hydration begins with the same text. Dates and times use the selected locale, while task calendar arithmetic uses `APP_TIMEZONE` and stored ISO dates.

## `date-phrases.json`

```json
{
  "schemaVersion": 1,
  "lang": "de",
  "name": "German",
  "locName": "Deutsch",
  "phrases": {
    "weekStart": 1,
    "relativeDays": {
      "today": ["heute"],
      "tomorrow": ["morgen"],
      "dayAfterTomorrow": ["übermorgen", "uebermorgen"],
      "yesterday": ["gestern"],
      "dayBeforeYesterday": ["vorgestern"]
    },
    "nextWeek": ["nächste Woche"],
    "weekAfterNext": ["übernächste Woche", "über nächste Woche"],
    "nextWeekend": ["nächstes Wochenende"],
    "weekendAfterNext": ["übernächstes Wochenende"],
    "weekdays": {
      "monday": ["Montag"],
      "tuesday": ["Dienstag"],
      "wednesday": ["Mittwoch"],
      "thursday": ["Donnerstag"],
      "friday": ["Freitag"],
      "saturday": ["Samstag"],
      "sunday": ["Sonntag"]
    },
    "next": ["nächste", "nächsten", "nächster", "nächstes"],
    "afterNext": ["übernächste", "übernächsten", "übernächster", "übernächstes"],
    "durations": {
      "prefixes": ["in"],
      "day": ["Tag", "Tage", "Tagen"],
      "week": ["Woche", "Wochen"],
      "month": ["Monat", "Monate", "Monaten"],
      "year": ["Jahr", "Jahre", "Jahren"],
      "numbers": { "ein": 1, "einem": 1, "zwei": 2, "drei": 3 }
    }
  }
}
```

Metadata/version rules are the same as for language catalogs. Phrase categories are optional; unknown category names are rejected. Each alias is literal text (1–100 characters), never executable regex. Supply inflections, abbreviations and transliterations explicitly. Each alias list has at most 80 entries; the complete catalog has at most 400 aliases/number words. Conflicting standalone aliases invalidate that catalog. Duration numbers are positive integers up to 365; digit counts use the same bound. `weekStart` uses JavaScript weekday numbers (`0` Sunday through `6` Saturday), defaulting to the language's locale week start; German defaults to Monday.

Language and date catalogs match by **exact canonical `lang`**, independently of URL order: `de` and `de-DE` are distinct catalogs. A date catalog without a matching language catalog is ignored and diagnosed. For duplicate languages the first valid entry in configuration order wins; invalid entries do not reserve a language. A language without matching valid date data keeps built-in German/English parsing. Matching custom data extends the built-in parser without guessing unsupported languages. Canonical examples live in [`public/locales`](../public/locales).

## Date semantics and parsing

- Relative days are offsets from the reference day in `APP_TIMEZONE`: today `0`, tomorrow `+1`, day after tomorrow `+2`, yesterday `−1`, day before yesterday `−2`.
- `nextWeek` means the start of the next calendar week; `weekAfterNext` means the start of the following calendar week. A weekday followed by either phrase picks that weekday **in that calendar week**, e.g. `Dienstag übernächste Woche` or `Tuesday the week after next`.
- For compatibility, a standalone weekday includes today when it matches; a `next` weekday prefix means its next strictly upcoming occurrence. An `afterNext` weekday prefix means its second strictly upcoming occurrence, preserving the existing `übernächsten Freitag` behavior even on a Friday. This distinction matters on weekdays already passed in the current week.
- Weekends use the next Saturday or second upcoming Saturday. This preserves the existing German weekend interpretation.
- Duration syntax is `prefix + digit/number alias + unit alias`, e.g. `in three days`, `in drei Tagen`. Days/weeks use calendar arithmetic across DST. Months/years retain the day of month and reject nonexistent target calendar dates instead of rolling them over.
- Longest full phrases are recognized before standalone weekdays, so no week modifier remains in the title. Case/NFC Unicode matching, calendar validity, relation protection, explicit ranges, conflicting-date warnings, and the existing European numeric date notation remain in place. Recognizing yesterday does **not** relax the existing prohibition on a past standalone deadline; past starts remain possible in explicit ranges.

## Quoted text, manual input and task feedback

“Treat quoted text as literal” defaults to enabled, including older preferences without the field. Straight double quotes, German `„…“`, and curly `“…”` protect dates, relations, tags, priority and recurrence. An unmatched opening quote protects the remainder; apostrophes in words are ordinary text. Disable the setting to retain the previous quoted-token parsing behavior. AI fallback is skipped for protected quoted input so it cannot reinterpret literal content.

Shared start/deadline inputs retain editable native drafts, committing on blur or Enter. Only a validated four-digit-year ISO calendar date or an intentional clear enters task state. Partial, invalid and five-digit-year drafts do not overwrite the previous valid date, render an invalid date preview, or enter persistence. Leap-year validation is arithmetic and independent of browser timezone. Native date-field presentation and segmented keyboard behavior are controlled by the browser/OS.

Manual refresh compares stable IDs from before its request and animates newly received rows visible in that same view, once. Initial reads, polls, updates, reordering and view changes do not trigger arrivals. Repeated overlapping manual requests are coalesced; reduced-motion users receive no entrance animation.

Completion and reopening use the existing optimistic mutation/error system. A bottom toast offers Undo while pending and after confirmation; pending Undo waits for the original success before writing the exact prior completion state. Each task has one active completion lane. Failed writes never produce a success toast; inverse-write failures use existing mutation rollback/errors. Confirmed toasts expire after eight seconds, remaining available while keyboard focus is inside them. Undo reverses the completion flag only: any recurring-task creation already confirmed by the existing server ledger remains intact.
