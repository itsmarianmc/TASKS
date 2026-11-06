# Notion integration and task mutation contracts

The integration uses official `@notionhq/client` 5.27 with an explicit **2026-03-11** API version. Only server modules instantiate the SDK. Database IDs discover their child data sources; queries, property schemas and page parents use data source IDs. Archive-delete sends `in_trash:true`, as required by the current API. It never creates, adds or alters database properties.

References: [Notion multi-source upgrade](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03), [2026-03-11 upgrade](https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11). Installed SDK types were inspected; its default still uses 2025-09-03, hence the explicit version.

## Configuration and discovery

### First-time setup

Create or identify **Tasks**, **Projects** and **Areas** databases in Notion. A database is the container; its data source holds the schema and rows used by the adapter. Add the same integration to all three using Notion's sharing/connections controls, and allow reading, inserting and updating page content. Merely knowing an ID does not grant access.

Configure the required properties in these tables before connecting TÆSKS. Add the optional properties for the features or Notion views you want to use.

#### Tasks

| Property | Notion property type | Requirement | Setup |
| --- | --- | --- | --- |
| `Name` | Title | Required | Use the database's built-in title property. |
| `Due Date` | Date | Required | Supports a single date or a start/end range. The cell can be empty. |
| `Area` | Relation → **Areas** | Required | Set the relation limit to **1 page**. |
| `Project` | Relation → **Projects** | Required | Set the relation limit to **1 page**. The selected project must include the task's area. |
| `Highlight` | Checkbox | Required | Create a separate checkbox for highlighting tasks. |
| `Done` or `Status` | Checkbox or Status | Required for completion and reopening | Choose one completion property. See [Completion and optional metadata](#completion-and-optional-metadata) for mapping. |

#### Projects

| Property | Notion property type | Requirement | Setup |
| --- | --- | --- | --- |
| `Name` | Title | Required | Use the database's built-in title property. |
| `Status` | Select (single-choice dropdown) or Status | Optional metadata | Define the choices or status options for your workflow. |
| `Priority` | Select (single-choice dropdown) or Status | Optional metadata | Define the priority options for your workflow. |
| `Areas` | Relation → **Areas** | Required | Use **No limit** to allow projects to belong to multiple areas. |
| `Tasks` | Relation → **Tasks** | Optional in Notion | Enable the two-way relation on **Tasks** → `Project` and name the reverse property `Tasks`. |
| `Deadline` | Date | Optional metadata | Use for project dates or date ranges. |

#### Areas

| Property | Notion property type | Requirement | Setup |
| --- | --- | --- | --- |
| `Name` | Title | Required | Use the database's built-in title property. |
| `Type` | Select (single-choice dropdown), Status, or Text | Optional metadata | Use Select for a dropdown of area categories. |
| `Open Projects` | Rollup (numeric result) | Optional in Notion | Choose the `Projects` relation, a numeric Formula property on Projects that flags open projects, and **Sum** as the calculation. |
| `Projects` | Relation → **Projects** | Optional in Notion | Enable the two-way relation on **Projects** → `Areas` and name the reverse property `Projects`. |
| `Tasks` | Relation → **Tasks** | Optional in Notion | Enable the two-way relation on **Tasks** → `Area` and name the reverse property `Tasks`. |
| `Database` | Relation → a database of your choice | Optional in Notion | Create it only if you want to link areas to another database in your workspace. |

See [Notion property types](https://www.notion.com/help/database-properties) and [Notion relations and rollups](https://www.notion.com/help/relations-and-rollups) for instructions on adding these properties.

TÆSKS derives area project lists from the required Projects `Areas` relation. You can keep existing property names, including names in other languages. Map required properties in Settings or with the environment variables below, and use the environment variables for optional metadata name overrides. Settings mappings take precedence over environment defaults. The adapter checks property types and relation targets and reports missing or ambiguous mappings.

Set the four required variables below, recreate the container, then open **Settings & diagnostics → Notion diagnostics**. Confirm all sources and fields resolve before creating a task. A normal Notion database URL contains a database ID; a selected view ID is not a data-source ID. TÆSKS discovers the data source when the database contains exactly one. If it contains multiple sources, copy each intended source's ID from Notion's data-source controls/API and set the corresponding explicit variable below. The adapter checks that it belongs to the configured database.

### Completion and optional metadata

A separate Tasks checkbox (for example `Done`) or status property (for example `Status`) is needed to complete/reopen tasks. It is **optional for ordinary task CRUD**, but completion remains disabled without a safe mapping. The mapped Highlight checkbox is never used as completion. If there are multiple candidates, select one in diagnostics or set `NOTION_TASK_COMPLETION_PROPERTY`.

For a checkbox, true means completed and false means open. For status, select an existing completed value and reopened value when inference is ambiguous, using Settings or `NOTION_TASK_COMPLETION_VALUE` / `NOTION_TASK_REOPEN_VALUE`. All options in a recognized completed status group read as complete. A reopened value must not belong to that completed set. TÆSKS does not invent options or guess among ambiguous values.

Task tags, priority, notes, uploads, reminders, recurrence and Someday are TÆSKS-local additions. Dates use `APP_TIMEZONE` (default `Europe/Berlin`), and date-only values remain calendar days. A single entered deadline is stored with a start because the adapter rejects deadline-only writes that Notion cannot represent faithfully.

These instructions are grounded in `src/lib/server/notion.ts` schema resolution and mocked adapter tests. They are not a claim of live synchronization in the current environment. The following sections describe the detailed existing contracts.

Required: `NOTION_TOKEN`, `NOTION_TASKS_DATABASE_ID`, `NOTION_PROJECTS_DATABASE_ID`, `NOTION_AREAS_DATABASE_ID`. Share all three databases with the integration and allow reading, inserting and updating page content. An unconfigured adapter returns an empty graph and explicit disabled diagnostics; production never loads fixtures.

Optional `NOTION_TASKS_DATA_SOURCE_ID`, `NOTION_PROJECTS_DATA_SOURCE_ID`, `NOTION_AREAS_DATA_SOURCE_ID` are required when their database contains multiple data sources. An explicit data source must belong to its configured database. TÆSKS will never pick the first of several sources.

Task property name overrides in [`.env.example`](../.env.example) are `NOTION_TASK_TITLE_PROPERTY`, `NOTION_TASK_DATE_PROPERTY`, `NOTION_TASK_AREA_PROPERTY`, `NOTION_TASK_PROJECT_PROPERTY` and `NOTION_TASK_HIGHLIGHT_PROPERTY`. Project and area titles are inferred from their unique title properties, and the project area relation is inferred from its unique relation target. Use `NOTION_PROJECT_TITLE_PROPERTY`, `NOTION_PROJECT_AREA_PROPERTY` and `NOTION_AREA_TITLE_PROPERTY` for explicit overrides. An invalid or ambiguous mapping disables writes and is reported in diagnostics. Optional metadata name overrides are `NOTION_PROJECT_STATUS_PROPERTY`, `NOTION_PROJECT_PRIORITY_PROPERTY`, `NOTION_PROJECT_DATE_PROPERTY` and `NOTION_AREA_TYPE_PROPERTY`.

Completion candidates are checkbox/status properties excluding the mapped Highlight property. No candidate means completion disabled. Several candidates require an explicit Settings selection. Status group names (Done/Complete and To-do, including recognized German names) identify completed/open options. A unique option or unique recognized semantic option can be selected automatically; ambiguous values require explicit completed/reopened mappings. All options in a recognized completed group read as completed. Explicit reopened values cannot be part of the completed set. No options are invented. Ordinary CRUD remains available when completion cannot be inferred.

## Read endpoints and cache

`GET /api/graph[?refresh=1]` returns `{graph,diagnostics,completionEnabled}`. Graph/schema caches last 60 seconds. Concurrent graph and schema reads share in-flight work. A module-level queue paces real SDK requests at least 350ms apart, including concurrent Settings/graph calls. SDK automatic retries are disabled because uncertain remote creates must not be replayed. Graph mutations expire the graph cache, while valid schema remains cached. Mapping changes recreate the adapter; manual refresh explicitly rereads schema and graph. Task writes always fetch fresh graph relations and retrieve the target page's parent.

All data-source queries paginate until `has_more:false`. Any truncated task or project relation paginates the page-property endpoint, also until complete. Broken cursor loops fail explicitly rather than returning a partial graph. Invalid existing task relations remain visible with diagnostics; normal creates and edits require exactly one available area/project with matching project membership. No arbitrary page can be edited or deleted: its parent must be the selected Tasks data source and it must be active.

Failed graph reads can return the process's last synced graph, with its original `syncedAt`, explicit stale/error diagnostics and `completionEnabled:false`. No durable local copy is made of Notion core data. Writes never validate against this stale fallback. Pending graph/schema reads carry their generation: invalidation cannot reuse an older promise, an old completion cannot replace the current cache or clear a newer pending read, and old successful callers join the current generation. All remote page/source/relation UUIDs normalize to canonical UUIDs; date/timestamps validate as ISO values and clickable URLs use the shared nonthrowing HTTP/HTTPS schema without credentials. Scoped GET and update responses must match both requested page identity and configured Tasks source. Trash success requires the requested UUID and `in_trash:true` from the response; unconfirmed success bodies remain errors and invalidate graph state.

`GET /api/notion/schema[?refresh=1]` returns safe property IDs/names/types, status option/group names, candidates, effective completion mapping and diagnostics. It never returns tokens, internal filesystem paths or remote error bodies. Mapping failure still attempts to list detected fields to support correction.

`POST /api/notion/mapping` accepts a `NotionMapping` directly. It validates the configured remote schema before persisting and returns `{schema,snapshot}`. Settings uses selects populated from actual properties/status options and updates local/schema/graph queries after success. Blank fields use environment defaults or conservative discovery. The generic local mapping action remains browser/server validated; invalid mappings disable the adapter instead of changing Notion.

## Core mutation endpoints

All mutations require same Origin and JSON content type and use the existing bounded request/validation boundary. Routes use Node runtime and promise route parameters.

`POST /api/tasks` accepts:

```json
{
  "task": {
    "title": "Make Presentation",
    "areaId": "NOTION_AREA_PAGE_UUID",
    "projectId": "NOTION_PROJECT_PAGE_UUID",
    "dates": {"start": "2026-10-03", "end": "2026-10-18"},
    "highlight": false
  },
  "metadata": {"priority": "high", "recurrenceRule": {"frequency": "week", "interval": 2}},
  "tags": ["school"],
  "source": {"source": "github", "externalId": "owner/repo#42", "url": "https://github.com/owner/repo/issues/42"}
}
```

Only `task` is required. `metadata` uses the existing validated metadata patch (priority, recurrence, reminder, Someday); tags are local names. Optional source is `github|contact` with stable external ID and nullable HTTP/HTTPS URL. Notion core succeeds first, then local details are saved. The response is 201 with `{task,warnings,snapshot?,existing?}`. If local extension saving fails after remote creation, it still returns the confirmed task ID and an explicit warning; the UI must keep that task and offer editing local details, never repeat creation. Existing source links/confirmed conversion ledgers return their existing task instead of creating another.

The Core UX phase adds optional `draftId` for resolving an existing local Inbox draft. Its independent migration 3 conversion ledger protects concurrent, uncertain and reopened draft conversions, including cases where local draft cleanup fails. The draft must exist unless its ledger already identifies a confirmed task; external drafts retain their original source. Combined draft/source claims release partial claims on failure. See `CORE.md` for client replay guards and the shared external composer interface.

Dates are ISO calendar dates. Existing date-only values preserve their day; datetime values are normalized into `APP_TIMEZONE`. Both-null clears dates. A deadline without a start is rejected before writing, because Notion cannot encode that range without changing its meaning. Composer/parser should default start to app-local today and validate end >= start. Start-only remains a genuine Notion single date.

`PATCH /api/tasks/:id` accepts `{task?:{title?,areaId?,projectId?,dates?,highlight?},completed?:boolean}`. A supplied date range is complete, with `start` and `end` nullable. It rejects empty patches and sends only changed Notion fields. Completion true writes the configured done value/checkbox; false reopens. Result is `{task,nextTask?,warnings,snapshot?}`.

`DELETE /api/tasks/:id` requires `{confirmed:true}` and returns `{deleted:true}`. The UI must first show its branded confirmation dialog. This trashes the Notion task using `in_trash`; it does not pretend to permanently erase Notion history.

Client integration should update/invalidate `["graph"]` and apply returned `snapshot` to `["local"]`. Always surface `warnings`, especially after core success. Errors carry user-safe message/code/correlation ID; Notion errors include source, operation and numeric upstream status without request bodies or secret-bearing messages. Unknown write outcomes ask the user to refresh before retrying.

## Recurrence and conversion safety

Completing a recurring task creates the next instance, using its local recurrence rule. Date-fns calendar arithmetic shifts both range endpoints and clamps month/year ends. Title, dates, project, area, Highlight, local tags, priority, recurrence and Someday carry forward; reminders and dismissed state do not automatically recur. Completing/reopening/completing the same source task cannot create the next instance twice.

The SQLite recurrence ledger claims the source task atomically before creation. Remote success is recorded before local extension writes. A timeout, crash or unconfirmed create leaves a creating/failed ledger and visible completion warning, never an automatic retry. The completed task remains completed. A user must inspect Notion before creating a replacement; no reconciliation falsely assumes remote failure.

SQLite migration 2 adds an external conversion ledger keyed by source/external ID. Claims prevent duplicate remote creates across concurrent requests and process restarts. Definite preflight, read or explicitly rejected 4xx failures release the claim to allow correction/retry. Uncertain create/network/5xx outcomes retain it. A confirmed remote ID is stored even if response mapping fails. The shared composer provides explicit inspected-task recovery through `POST /api/tasks/reconcile`, using only scoped Notion GET then atomic local links/ledgers. Active creating claims cannot be overwritten; confirmed links cannot be retargeted. The first database connection of a fresh supported single server process marks interrupted creating claims uncertain, without issuing any remote writes. Later conversion requests return the verified existing task. No automatic recreation occurs.

## Verification

Mocked official request shapes cover disabled setup, multi-source selection, schema/type/target validation, absent/ambiguous completion, status groups/mappings, full graph and relation pagination, timezone normalization, range roundtrip, CRUD/reopen/trash, scope checks, stale fallback, safe errors and concurrent read deduplication. Real in-memory SQLite tests cover metadata/tags, atomic concurrent conversions, preflight retry, uncertain write suppression and recurrence. HTTP tests verify structured mutations, Origin checks and deletion confirmation. Live Notion connectivity requires the user's token and database sharing; no live connection is claimed without them.
