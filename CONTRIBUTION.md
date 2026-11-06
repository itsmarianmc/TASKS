# Contributing translations

TÆSKS welcomes translation pull requests through [its GitHub repository](https://github.com/itsmarianmc/T-SKS). Repository inclusion identifies where a translation comes from; it does not promise human review or certification.

## Create a language pair

1. Fork the repository and create a branch from `main`.
2. Copy `public/locales/en/` into `public/locales/<language>/`. Use a valid canonical BCP 47 language tag, for example `fr` or `pt-BR`. Keep the folder tag and both JSON `lang` fields identical after canonicalization.
3. Translate **both** `language.json` and `date-phrases.json`. English is the source of truth. German provides another complete example.
4. Run `npm ci` with Node 24+, then `npm run catalogs:generate`. This validates every pair and generates the internal bundle automatically. Do not edit or commit the generated index.

Both JSON files require `lang`, English `name` and native `locName`; set `schemaVersion` to `1`. Unknown metadata fields are rejected. Native names keep the selector readable. Do not insert source IDs or origin metadata into submitted files; the server adds those itself.

Keep **every English string key**, without inventing new keys. Preserve placeholder names and occurrences such as `{p0}` and `{p1}`; their order may change to suit the language. Placeholders contain user data and must not be translated. Use plain text, not HTML, scripts, Markdown formatting or executable expressions. Keep technical identifiers, URLs, brand names, commands and configured Notion property names unchanged when translation would change their meaning. Use JSON escape sequences for quotation marks, backslashes and line breaks. Do not add comments or trailing commas. Each file must fit within 256 KiB; individual UI strings are limited to 4,000 characters, metadata names to 100 characters, and the schema allows at most 3,000 keys.

In `date-phrases.json`, translate literal phrase aliases for relative days, calendar weeks, weekends, weekdays, modifiers and durations. Include useful inflections, abbreviations and transliterations explicitly. Aliases are literal strings, never regular expressions. Do not map one standalone alias to conflicting meanings. Arrays allow up to 80 aliases of 1–100 characters each; the full catalog allows at most 400 aliases/number words. Duration number values are integers from 1 to 365. `weekStart` is `0` for Sunday through `6` for Saturday; omit it to use the locale default. Optional categories may be omitted when they do not apply; unsupported temporal grammar is not inferred automatically.

The [complete catalog specification](docs/language-catalogs.md) describes schemas, date semantics, limits and compatibility rules. Small JSON snippets there illustrate structure; a submitted UI file must contain the full current English key set.

## Check your translation

Run:

```text
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e -- tests/e2e/catalog-interactions.spec.ts tests/e2e/startup.spec.ts
```

Use isolated data and disabled real integration credentials for browser checks. Inspect Settings, navigation, Quick Add, validation, empty/loading/failure states, dialogs, success feedback and reminders in both themes and at mobile widths. Check accessible names, keyboard navigation, long labels and reduced motion. Task titles, project/area names, notes, tags and external messages must remain unchanged. New users start in English, regardless of browser language; choose your language in Settings and reload to verify persistence.

Test date phrases against fixed reference dates, including weekdays, next/week-after-next behavior, ranges, month/year boundaries and DST in `APP_TIMEZONE`. Preserve German and English parsing. Check missing/invalid catalogs fall back safely and that the UI, parser and generic service-worker notification copy use the same selected source. Unit fixtures should test failures without contacting a live service; physical device notification delivery requires separate verification.

For Docker, `docker build -t taesks-translation-check .` must bundle your folder without any manifest edit. Run only an isolated test container with a fresh data volume, no real credentials, and an unused host port. Check both English and German with outbound network blocked. The running-image discovery tests use controlled GitHub fixtures to simulate a new folder/commit and a refresh in one process. A local or unmerged pull request is **not** on upstream `main` and will not appear through production remote discovery. See [deployment and verification](docs/DEPLOYMENT.md) and [current checks](docs/english-experience-verification.md).

## Submit a pull request

Commit the two source files under your new folder and any useful tests. Run the checks, push to your fork, then open a pull request against `itsmarianmc/T-SKS:main`. Describe the language, native name, date aliases, checks run and any limitations or help needed. Keep screenshots free of private task data. Follow `AGENTS.md` for code changes. A pull request does not imply project verification of the translation.

## Try an external translation

You can host the same pair in a public or server-reachable HTTP(S) folder without a directory listing:

```dotenv
TRANSLATION_FOLDER_URLS=https://translations.example.org/fr/, https://translations.example.org/pt-BR/
```

The app requests only `<folder>/language.json` and `<folder>/date-phrases.json`, subject to the same compatibility contract. External translations have not been verified by the project. Settings lists them first with `[!]`, above the separated repository group. Matching language codes remain separate choices; the chosen source persists. A URL change creates a new external source identity. See the specification for exact URL, refresh, fallback and migration rules.
