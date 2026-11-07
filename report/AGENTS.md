<!-- APP_STANDARDS:START -->
# Bkper App Standards

This section contains reusable architecture and quality guidance. It is editable, but preserve it by default and change it only when explicitly requested. Never replace this file wholesale merely to specialize the app. Preserve both guidance marker pairs and maintain the app-specific section as the app evolves.

Follow the Bkper App Quality Guidelines, indexed as `apps/quality.md`, when implementing, refactoring, or reviewing this app.

## Architecture principles

This template is intentionally opinionated. It should be enough to bootstrap an app and provide a strong basis for growing it.

Treat the app API as a first-class product surface:

- Expose reusable app behavior through typed `/api/v1/*` routes whenever it may be used by more than one caller.
- The shipped web client is only one consumer of the API; scripts, external clients, and agents should be able to call the same routes.
- Keep business behavior in `server/src/services/` and expose it through thin routes in `server/src/api/routes.ts`.
- Keep route contracts in `server/src/api/schemas.ts` and document them through the generated OpenAPI spec at `/openapi.json`.
- Keep Lit components focused on rendering and user intent. Do not hide app behavior only in UI components.
- Prefer adding meaning with typed request/response schemas and properties before adding new structural layers.

When adding API behavior, update the server schema and route, add or update unit tests, regenerate the typed client API types with `npm run api`, and intentionally update the OpenAPI snapshot when the public contract changes.

Keep `README.md` focused on end users because it appears on the app listing. Include concise API access details when relevant, but keep development setup, architecture, source control, and compatibility rules in `AGENTS.md` or internal documentation.

## Authentication

Do not implement custom OAuth flows, redirect handling, or token refresh.

| Context               | Pattern                                                                                                               | Location                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Web client direct API | `@bkper/web-auth` provides the token and refresh operation configured in `bkper-js`                                   | `client/src/auth/auth-session.ts`, `client/src/services/book-service.ts` |
| Client app API calls  | The typed API client uses `auth.authenticatedFetch()`; other callers send `Authorization: Bearer <token>` to `/api/v1/*` | `client/src/api/app-api.ts`       |
| Server API routes     | Platform validates bearer auth and injects auth for server-side `new Bkper()` calls                                    | `server/src/api/routes.ts`        |
| Event handlers        | Platform routes `/events`; handler uses `new Bkper()` with outbound auth injection                                    | `server/src/events/routes.ts`     |
| Local dev             | Vite client auth and local outbound both use your CLI credentials (`bkper auth login`)                                | `client/vite.config.ts`, `bkper app dev` |

## Project structure

The root package orchestrates install, dev, test, build, and deploy. Keep browser UI dependencies in `client/package.json`, Worker dependencies in `server/package.json`, and root dependencies limited to cross-package tooling such as the Bkper CLI, Miniflare, and OpenAPI generation.

Keep components focused on rendering and user intent. Register only the Web Awesome components used by the app in `web-awesome.ts`, and style with `@bkper/web-design` tokens. Put auth mechanics in `auth/` and Bkper/client API calls in `services/` and `api/`. Keep shared client state in stores under `state/`, as the Client state guidelines describe: `route.ts` alone reads and writes the URL's path, query, and history, and `app-state.ts` creates and wires the stores. Co-locate each component's view and CSS in one component folder; keep simple presentational components in one file.

Keep server route handlers thin. Put API shape and validation in `api/`, event transport concerns in `events/`, and business behavior in `services/`.

## UI grounding

Web Awesome official Agent Skills are generated resources synced from the installed `@awesome.me/webawesome` package by running:

```bash
npm run agent:skills
```

Before UI work, agents MUST read:

- `.agents/skills/webawesome/SKILL.md`
- `.agents/skills/webawesome-design/SKILL.md`

Preserve the template UI foundation:

- Use Web Awesome components as the primary UI building blocks.
- Style with `@bkper/web-design` tokens instead of ad-hoc design constants.
- Keep the first-paint dark mode script in `client/index.html` before `/src/index.ts`.
- Keep the client/server layering described above, including client state in `state/` stores with the URL's path, query, and history only in `route.ts`.
- Keep the typed API/OpenAPI workflow: update schemas/routes/tests, run `npm run api`, and review the OpenAPI snapshot for public contract changes.

## API contract

The app's public API lives under `/api/v1/*` and is documented at `/openapi.json`.

| Concern                    | File                                      |
| -------------------------- | ----------------------------------------- |
| OpenAPI document metadata  | `server/src/api/openapi.ts`               |
| Request/response schemas   | `server/src/api/schemas.ts`               |
| API route definitions      | `server/src/api/routes.ts`                |
| Server business behavior   | `server/src/services/`                    |
| Generated client types     | `client/src/api/generated/types.d.ts`     |
| Shipped web client wrapper | `client/src/api/app-api.ts`               |

Design API operations around the app's domain behavior, not around the current UI. The UI should call the same routes that another authenticated client could call.

When an app API exposes a Bkper REST API payload, reference its canonical `bkper.*` type through `x-typescript-type`; do not recreate Bkper API interfaces locally. Follow `BookSchema` in `server/src/api/schemas.ts`. This bridge provides compile-time types only, so request bodies still require concrete Zod validation.

API evolution rules:

- `/openapi.json` is the single canonical public contract. It may contain multiple API versions over time.
- Keep `/api/v1/*` and its existing schema names stable once clients may depend on them.
- Do not rename or version schemas just for additive changes. Old generated clients should keep working until they explicitly upgrade.
- Safe changes are additive: new routes, new optional request fields, and new optional response fields.
- Breaking changes include removing or renaming fields, changing field types or meaning, changing route semantics, narrowing accepted input, or making optional inputs required.
- Put breaking changes in a new namespace such as `/api/v2/*`; do not mutate existing `v1` contracts.
- Add new versioned schemas only when a breaking payload shape is needed. Keep the old schema available for old routes.
- Mark old operations with OpenAPI `deprecated: true` only after a migration path exists.
- The committed contract snapshot is `server/test/api/openapi.snapshot.json`; update it only after reviewing the API change.

Agent API change checklist:

1. Classify the requested API change before editing code: additive or breaking.
2. If additive, keep the existing API version and schema names; update routes, schemas, tests, generated client types, and the OpenAPI snapshot.
3. If breaking, add a new API version such as `/api/v2/*`; preserve the old route handlers and schemas for existing clients.
4. Never remove, rename, or tighten a published `v1` field or route unless the user explicitly asks to break compatibility.

Authentication for `/api/v1/*` callers is always bearer-token based:

```http
Authorization: Bearer <bkper-oauth-token>
```

Inside server API routes, do not read or forward that token manually. Use server-side `new Bkper()` and let the platform validate inbound auth and inject outbound auth for Bkper API calls.

## Development

```bash
bkper auth login
npm install
npm run dev
```

This runs:

- `vite dev` — client dev server with HMR
- `bkper app dev` — one Miniflare Worker and an event tunnel to the same Worker when events are configured

The Bkper Agent's sandbox sets `BKPER_LIVE_HOST` to show the App live: `client/vite.config.ts` then accepts that host and serves HMR through the page's own origin. Keep that branch when changing the Vite config.

## Verification

Before considering a code change complete:

1. Review the changed code against the Bkper App Quality Guidelines.
2. Run the deterministic root check:

```bash
npm run check
```

The quality review covers design concerns that automated checks cannot prove. The root check validates the guidance markers, regenerates derived API/environment types, typechecks and tests the app against them, verifies production builds, checks formatting, and fails if tracked generated files are stale.

Unit tests must inject or mock Bkper clients and `fetch`; never read from or write to live Books. Mirror `src/` boundaries under each package's `test/` directory, while keeping package-wide setup and composition tests at the test root.

## Build and deploy

```bash
npm run deploy:preview # local build + explicit preview deployment
npm run deploy         # local build + explicit production deployment
```

Git push never deploys. Managed sync/deploy safely push a clean committed attached branch and deployment verifies that exact remote commit before uploading the existing local build. This is best-effort source provenance, not reproducible remote CI. External and monorepo workflows retain direct upload behavior.

For a managed rollback, create an attached `rollback/<name>` branch at the selected commit, build locally, and deploy explicitly. To clone managed source, run `bkper app clone <appId> [path]`, enter the clone, and run `npm install`; clone never executes repository lifecycle scripts.

Build output:

- OpenAPI client types → `client/src/api/generated/types.d.ts`
- Vite client build → `dist/client/`
- Worker bundle → `dist/server/`
<!-- APP_STANDARDS:END -->

<!-- APP_SPECIFICS:START -->
# Report

## Overview

Report turns a short request, in any language, into a financial report of a Book. The web client and the Bkper Agent call the same app API.

- **Client**: Lit + Web Awesome Pro; a Book picker and, for the selected Book, one input whose report builds as the person types, with the Book and the request in the URL as `?book=<bookId>&q=<request>`, and, in a Book, the report's state (`&state=`, see Report state).
- **Server**: Hono Worker serving typed OpenAPI `/api/v1/*` routes. No `/events`: financial reporting only reads Books. The saved-prompt shelf writes only Book-scoped app metadata, never Book resources. Singular `/report` computes; plural `/reports` persists original requests. Both the web client and other authenticated callers use these same service-backed routes.
- **Shared** (`shared/`, package `report-shared`): the report catalog, the strings, bidirectional text and the Bkper languages, imported by both the server and the renderers. It holds only environment-neutral code (no DOM, Worker or Bkper SDK), so browser bundles never pull server code.

## Accounting rules

- Numbers come only from deterministic code over Bkper balances. AI may choose among options the code offers; it never computes amounts or dates, and never writes queries.
- Read-only on Books: never create, update or delete Book resources, and do not subscribe to events. The sole persistence exception is the explicitly requested saved-prompt shelf in app KV (original prompt text only); it never writes to a Book, its executable saved queries or its financial data. Normal report computation remains read-only.
- Periods resolve to ISO dates in the Book time zone: `after:` inclusive, `before:` exclusive. Only "today" reads the clock. A request that names no period reads activity (Incoming, Outgoing) for this year, positions (Asset, Liability) today, and a trend over the last 12 months; when this year or those 12 months have no movements in the report's groups, it reads the last year that has them (`defaultPeriod`), so Books with old data still show their data. Current periods (this month, quarter and year, year to date, the last 12 months, all time) end at tomorrow, so they include today and exclude future-dated transactions; past periods are whole calendar periods. Comparisons are calendar-aligned: a whole period compares with the previous month, quarter or year; a current period with the same span one period back, its day clamped to the end of a shorter month. A position compares with the position at the end of the previous period (for today, the end of last month). All time has no comparison.

## Book snapshot

The snapshot is the Book's map (`server/src/services/snapshot.ts`), loaded by `snapshot-loader.ts`: group and account names, the hierarchy, natures, and the months each group and account had movements in (`activeMonths`; debits or credits, even when they net to zero), from which default periods, Jev's options and suggestions are chosen. It never supplies a shown amount.

- Accounts in no group are apart (`ungrouped`, from the Book payload), with their natures and no months: no root's query reads them, and querying each would slow every snapshot.

- One `bkper.getBook(id, true, true)` call, then one query per root group, all in parallel: `group:'<root>' before:<tomorrow> by:m`, the only way Bkper tells which months had movements and in which order it lists children. Never query several roots at once: unbounded multi-group queries are slow and can fail.
- Accounts appear once even when several roots contain them.
- Bkper leaves archived accounts whose balance is zero today out of balances, so they are not in the map.
- KV caches a snapshot for 60 s per user and Book (`snapshot:v3:<userId>:<bookId>`; `v1` held amounts, `v2` lacked the accounts in no group). Identifying the user (`currentUserId`) costs one `getUser` call per request; the balances cache needs it too. `Server-Timing` reports `user`, `kv` and `balances`; the per-request `ServerTiming` lives in `AppContext`.

`npx tsx scripts/verify-snapshot.ts [--today=YYYY-MM-DD] <bookId>...` checks snapshots of live Books, read-only, with your `bkper auth token`: cold and warm load times, the tree and the accounts in no group against `bkper group list`/`bkper account list`, and the months with movements of every group and account against `bkper balance list` by month (each month with a balance there is one, and each is a month it lists). `--today` reads a Book as of an earlier day.

## Report balances

Every amount a report shows is a Bkper balance of one group or account, read from the response to one of the report's own queries, with the sign Bkper shows in its charts (bkper-js representative balances: negated for debit nature). Report never adds or subtracts amounts across groups or accounts and never changes a sign by nature; the one exception is a net result it calculates (see Report calculation). Amounts stay decimal strings; compute with bkper-js `Amount`, never binary floats.

- `planReport(intent, snapshot)` (`report.ts`) names the queries: for each root (the root, or each root of a net result Report calculates; never several roots in one query), one of the period, `group:'<root>' [#tags] [after:<start>] before:<end> by:m`, and one of the previous period the same way, run in parallel (`planQueries`). Partial-month comparisons and today are ordinary period queries.
- A report's subject (`ReportSubject`) is the node it is of, a net result Report calculates, or targets side by side. The intent's optional `target` (an id) is a group or account under its root group, at any depth: the plan reads the root's queries, exactly those of the root's own report, and the report reads the target from their responses by name (no query of its own, so the root's cached balances serve every target under it); an account under several roots reads the same from any of them. An account in no group is a root of its own (`root` is its id, with no target), read with `account:'<name>' …`. A target with `net-result`, with an account root, equal to its root, or not under it is `ReportError` `unknown_target`, before any query; an account in a group as `root` stays `unknown_root`. The nature (position or activity) is the subject's own, a target's rather than its root's.
- Targets side by side (`alongside`: more `{ root, target? }` after the intent's own `root` and `target`, at most `MAX_ALONGSIDE` (5)): each is checked exactly as a single subject (a root, an account in no group, or a target under its root; `net-result` among them is `unknown_target`), the same group or account asked for again (even under another root) is shown once, in the order asked for, and one left alone is that subject's own report. All must be positions or all activity, else `ReportError` `mixed_targets` (API 422), before any query. The plan reads each distinct root's queries once, in parallel, exactly those of the root's own report, and each target from its root's responses. "A and B" and "A versus B" are the same report.
- Bkper answers a query of an account it does not find by its name with no balances at all: in some older Books (Nimbus, Personal finances), `account:'<name with spaces>'` finds nothing, in balances and in transaction search alike (bkper-core `BookEntity.getAccountIdsMap` looks a single name up by the account's stored normalized name, which seems older there). Groups and root responses are unaffected, so targets under a root read correctly; an account in no group that is not archived and is missing from its own answer is `MissingBalancesError` (API 502 `upstream_error`), never a zero. A report's link to Bkper for an account (`account:'<name>'`) is Bkper's own query and shares that limit.
- Activity reads a node's period balance (the total) and its monthly period balances (a month without a bucket had none); a position reads its cumulative balance at `before` and, by month, the cumulative balance of the month's bucket or of the last one before it (Bkper leaves out months after the last movement). Months are never added up into totals.
- Hashtags filter every query. A position with hashtags reads without `after:`: under `after:`, Bkper's cumulative balance starts from the balance of every movement, with the hashtags or not.
- `readQueryBalances` (`balances.ts`) keeps a response's balances by Bkper name, each node's nature (`credit`, `permanent`), and the subgroups and accounts Bkper lists under each group; a node Bkper left out of a response has no balance there (zero).
- `loadBalances` (`balances-loader.ts`) caches each exact query's balances for 60 s in KV per user and Book (`balances:v2:<userId>:<bookId>:<sha-256 of the query>`; `v1` had no structure; queries can be longer than a KV key), reads the misses from Bkper in parallel, and stores them in the background. `kv` and `balances` in `Server-Timing` include it. A report's `dataAt` is when its oldest balances were read.

## Report calculation

`buildReport(intent, snapshot, balances)` (`server/src/services/report.ts`) turns an intent and the balances of its planned queries into report data: the answer (amount, previous, change), the months of the period, the main chart and every chart that fits (`charts`), the breakdown tree, type colors, the exact Bkper query and its URL. It is pure and deterministic.

- `root` in the report data is its subject: the root group, the target, the account in no group, the combining group, or `net-result`. A target's report is the root's report drawn from the target instead: its own balance as the answer, the rows Bkper lists under it (an account has none), its series by month, its name as the title, and `query` (the Source and the link to Bkper) the target's own filter (`group:'<target>'` or `account:'<target>'`, with the hashtags), so the link shows exactly its transactions.

- Targets side by side (`targets` in the report data, which is also the `breakdown`; no `root` and no `answer`): each target a row in the order asked for, with its own Bkper balance now, before and by month, and the rows Bkper lists under it (with their shares of it), as in its own report. Nothing adds them up: no total, no share of the targets, nothing calculated. `query` is `(<filter> OR <filter> …) [#tags] <dates>`. Charts are computed by the same rules with `facts.sideBySide`: by month a series per target, `area`, `ranked-bar` (the targets with an amount, ranked by size), `compare` and `table` fit; `donut`, `pie` and `stacked` never do (`side_by_side`, the charts that imply a whole), nor `waterfall` (`no_bridge`). With no view or chart asked for, ranked bars.
- Roots that are permanent (Asset, Liability, or mixed of both) report a position at the period's `before`; all others, and the net result, report activity within the period.
- A calendar period that contains today (`2026`, `2026-Q4`, `2026-11`) reads to date as its current period (`this_year`, …), so no report includes future-dated transactions. Periods that have not started are rejected (`ReportError`, `future_period`).
- The breakdown holds only the rows Bkper returns (`RowReader`): the subgroups and accounts each response lists under a group, in either period, each with its own balance as Bkper returns it, so a mixed group's rows need not add up to it. There is no remainder row: a node Bkper leaves out is no row, and one it returns that the map lacks (such as an account archived at zero) is a row, `group:<name>` or `account:<name>`, typed by its nature. Rows without amounts in any period or month are left out; rows are sorted by size, then rows without an amount in the period, which charts leave out. Shares (`child / parent`, display ratios) are left out under mixed parents.
- The net result (`net-result`, `netResultOf`): the root group that combines Incoming and Outgoing accounts (mixed, not permanent), the one with the most accounts, the first in Book order on a tie: its report is that group's, as Bkper calculates it. Else, when every activity root is purely Incoming or purely Outgoing, there are both, and no two share an account (in the map, and again in the responses), `calculatedNetResult` is the one amount Report calculates: Bkper's totals of the Incoming roots minus those of the Outgoing roots (`Amount`), in the period, the previous one and each month (`calculated.months`), with the roots as its rows, Incoming first, a `total` row and a series per root under its line; the spec labels it "Calculated by Report" (`source_calculated`) with a hint to add a combining group. Any other structure has no net result: `ReportError` `no_net_result`, before any balances query (API 422 `no_net_result`, the client's `error_no_net_result`). A Book without activity roots is still `no_activity_roots` (`not_a_report`).
- Every chart that fits is computed (`charts.views`, in `VIEW_KINDS` order: `bar` or `line` by month, `area`, `stacked`, `ranked-bar`, `donut`, `pie`, `compare`, and `table`, which always fits, as `{ kind: 'none' }`), from the same rows and months, so a renderer can switch between them with no new numbers. Each chart's fit is decided by code from the report's facts (`charts.facts`: top-level rows with an amount, how many are negative, whether they are of another type than the root or under a mixed root, months, a previous period, a net result (calculated, or of a mixed activity group), a permanent root, targets side by side), and a chart that does not fit has an `UnfitReason` (`net_result`, `negative_part` with its `rowId`, `mixed_parts`, `few_parts`, `too_many_parts`, `few_months`, `no_amounts`, `no_previous`, `not_a_whole`, `no_bridge`, `side_by_side`; the contract keeps `not_a_bridge` and `no_change`, no longer given). Charts never imply a whole that does not exist: slices and stacked parts must add up to the root's own balance (`not_a_whole`, a comparison of Bkper's amounts that shows no sum).
- The main chart (`chart`, its kind `charts.main`) and the rule that chose it (`charts.rule`): the preference when it fits (`preference`); else the first fitting chart of its `CLOSEST` list (`closest`: `bar` → line, area, ranked bars, donut; `line` → bars, area, ranked bars, donut; `ranked-bar` → by month, donut; `donut` → pie, ranked bars; `pie` → donut, ranked bars; `stacked` → by month, area, donut, ranked bars; `area` → by month, stacked, donut, ranked bars; `compare` → ranked bars, donut; `waterfall` → compare, ranked bars, donut), a chart by month standing in only over 2+ months; else, as for `auto`, the rules (`rules`). A preference that does not fit is `charts.unfit` (its kind and reason) and marks the main chart `fallback: true`; it is never among the views.
- Charts by the rules: the named view first; otherwise `monthly` means by month (bars for activity, a line for positions; a net result Report calculates draws a bar series for each of its roots that has an amount, and the net result as a line over them; no chart when every value of every month is zero, as charts leave out rows without amounts), else a breakdown chart over the rows with an amount: a donut for 2–6 positive rows of the root's type, ranked bars otherwise, none for fewer than two. The `breakdown` view (a composition asked for) also draws a pie of more positive rows of the root's type than a donut holds. `total` has no chart.
- The intent's `chart` (`REPORT_CHARTS`) is the person's preference; left out or `auto`, the rules choose, so older intents give the same main chart. What each chart needs to fit:
  - `bar` (activity) or `line` (positions) by month: 1+ months with an amount in any of them; the other of the two only when preferred, from the same series. `ranked-bar`: 2+ rows with an amount.
  - `pie`: the rows with an amount, 2 or more, all positive and of the root's type (not under mixed groups or a net result), adding up to the root; a `donut` also at most `MAX_DONUT_ROWS` (6).
  - `stacked`: a series per top row with an amount in a month, each drawn, for 2+ months, 2 to `MAX_STACKED_PARTS` (6) parts of the root's type (not a net result or a mixed group), adding up to the root in every month.
  - `area`: the series of the chart by month, for 2+ months, when any of them has an amount in a month.
  - `compare`: the rows with an amount now or in the previous period, when there is one (not all time).
  - `waterfall`: never fits (`no_bridge`): its bars would be sums Report makes. It stays in the intent, state and catalog contracts, so a request for one shows it dimmed with its reason, and the closest chart (`compare`, ranked bars, donut).
  - `table`: no chart, always.
- Ratios (`change`, `share`) are decimal strings rounded to 4 places; format them, and amounts, only when rendering.

`npx tsx scripts/verify-report.ts [--today=YYYY-MM-DD] [--hashtag=<tag>] <bookId>...` builds reports of several intents per root (and the net result), and of targets (every subgroup and the two busiest accounts of the year under each root, and the first three active accounts in no group, by month, a quarter, the last month compared and today; with `--hashtag` too), from their own queries, as the Worker runs them, and cross-checks them against `bkper balance list`, read-only: a target against the CLI's query of the target alone (an account under a root against its row in the CLI's query of the root, as the CLI's `account:'<name>'` finds nothing for some accounts of older Books), after checking that it reads exactly its root's queries (an account in no group, queries of its own; one Bkper does not find by name is no report, and the CLI finds nothing either); the answer and previous period, and every row at any depth now, before and in every month, each as Bkper's own balance of its group or account, to the cent; that every group or account the CLI lists with an amount is a row (nothing hidden); where the net result comes from, against `bkper group list` and `bkper account list` (the combining group, simple roots, or none, with `no_net_result`), and a calculated one as the CLI's Incoming roots minus its Outgoing roots, in total, before and every month, with no account under two roots. It also asks every root for each chart preference and checks the data of every chart that fits each report, the main one and every other view, against the CLI: each month of a chart by month, the parts of a breakdown chart (exactly the rows with an amount, positive in a pie or donut, adding up to the root), each stacked part in every month (at most six) and their sum against the root, each compared row; that no bridge is drawn and one asked for is unfit as `no_bridge`; and that the main chart is one of the views, and an unfit preference is not. Each line shows the preference, the main chart, the rule that chose it, the unfit preference's reason and the number of views. It also shows targets side by side (the activity or position roots, a root with a group or account under it, targets of different roots, a root with an account in no group; by month, a quarter, compared, a pie and stacked asked for, today, the reverse order, a repeat, and with `--hashtag`), each checked against the CLI's query of that target alone as above, and that they read exactly their roots' queries, each once, in the order asked for, with no total, share or calculation, only charts that imply no whole, and that positions with activity are `mixed_targets`. The CLI shows raw balances negated for permanent accounts (Liability and Outgoing negative), so it flips a CLI amount when its row's `credit` equals its `permanent`.

## Intent resolution

`resolveIntent(prompt, snapshot, { client, timing })` (`server/src/services/intent-resolver.ts`) turns a request in any language into a `ReportIntent` with ONE decision request to Jev, measured as `jev` in `Server-Timing`. It returns `{ recognized: true, intent, language?, trace }` or `{ recognized: false, language? }` (not a report). Jev makes judgments, code makes decisions.

- `intent-questions.ts` holds every question, criterion and threshold (`THRESHOLDS`); review and tune them there, together. Jev only chooses among options code offers, or answers yes or no: the root groups (by name, described by their nature and up to 60 subgroup and account names) plus `net-result` and `none`; the period options of `buildPeriodOptions` within the snapshot's data range plus `unspecified`; four yes/no recognition questions (`over_time`: month by month; `composition`: broken down into parts; `versus_earlier`: compared with an earlier period it names; `bridge`: one amount leading to another, step by step); the chart word the request uses (`chart_named`, `CHART_NAMED_CRITERIA`: `pie` (a donut too), `bars`, `line`, `area`, `stacked`, `waterfall`, `table` for just the numbers, or `none`, with examples in several languages); the 133 Bkper languages (`report-shared/languages`). Each question stands alone: none refers to another or says when not to answer yes (a test checks the yes/no ones). State is only `{ request, today }`.
- Code applies the thresholds (`none` or an unsure root is not a report; an unsure or unspecified period reads `defaultPeriod`; an unsure chart word is `none`; the language is returned only when sure, ≥ 0.8), then the rule table `SHOW_RULES` decides how to show the report, the first rule that applies: `named` (the chart word: `pie`, `line`, `area`, `stacked`, `waterfall` and `table` as themselves; `bars` by month over time, `compare` versus an earlier period, else `ranked-bar`); `bridge` → `waterfall`; `versus_earlier` → `compare`; `over_time_composition` → `stacked`; `over_time` → the `trend` view; `composition` → the `breakdown` view (a donut or a pie by the facts, else ranked bars); `auto` (the rules). `over_time` also sets `monthly`, whichever rule fired; it, or a preferred chart by month (`bar`, `line`, `area`, `stacked`), makes the default period the trend one. Which charts fit is decided afterwards by `buildReport`, from the facts.
- `trace` (`IntentTrace`) holds each judgment's answer and score (a choice's confidence, a yes/no's probability of yes, with `answer` after its threshold), the rule that fired, and `names`, the Book's names the request writes, when it writes any.
- Hashtags come from the request text (`extractHashtags`), never from Jev, so a caller can start `hashtagQuery` in parallel with Jev.
- Names come from the request text too (`findPromptNames`, `prompt-names.ts`), never from Jev: whatever wrote the text (typing, autocomplete, a saved request, `q`, the Agent API), the exact names of the map's groups and accounts it writes are what the report is of, side by side when several (the first as `root`/`target`, the rest `alongside`, at most `MAX_NAMED`, 6), whatever Jev's root answer, `none` included. Jev is asked the same single decision request either way (byte for byte: no state or question is added), and its root is read only when the request writes no name, so a renamed group or account in a saved request falls back to the root Jev chooses, and the title shows it. The rules, in order, documented in the module, and shared with the web client's completion in `report-shared/names` (`matchNames`, `pickName`, the folding and the word boundaries), so both always agree: whole names ignoring case and accents (NFKD, lowercase, no marks, whitespace runs as one space), starting and ending at an `Intl.Segmenter` word boundary (so languages written without spaces work) or next to a character that is not a letter, mark or digit, and starting after a run of whitespace, not inside it (so a name after two spaces is still written exactly); never names of one character, nor names inside `#hashtags`; the longest match first, then the one that starts first, dropping any that overlaps one taken; colliding names (alike once folded): the one written exactly, then a group over an account, then Book order (each root with its subgroups, then its accounts, then accounts in no group); each once, in the order written. A group's root is its top-level group, an account in no group is its own root, and an account under several roots is read from a root another name can only be read from, else the first root in Book order holding it (its own balance either way). Code then decides from the names: their default period (the first's nature, the last month any of them moved; accounts in no group have no months in the map, so this year or today), and no composition side by side (they are no whole, so "Food and Rent by month" is a trend, not stacked parts); positions with activity stay `mixed_targets` when planned. Finding names indexes every name of the map on each request, with no cache: about 2 ms for 500 names and about 60 ms for 25,000 accented ones (measured locally).
- `decision-client.ts` is the TypeSafe SDK connector: the platform outbound placeholder key in the Worker, a short timeout and one retry for typing, and `BkperAiError` keeping the Bkper AI error `code` (such as `usage_limit_exceeded`) for routes to map.

`BKPER_AI_TOKEN=<token> npx tsx scripts/eval-intent.ts [--only=<n>,...]` asks real Jev ~95 multilingual requests on the two test Books (snapshots read-only with your `bkper auth token`; Jev with `BKPER_AI_TOKEN` or the same token), chart requests among them (short ones such as "despesas em pizza" or "費用 円グラフ" too) and requests that write the Books' group and account names (longest names, accents left out, several side by side, accounts in no group, in Japanese, Chinese, Arabic, Hindi and Korean among others), and reports accuracy of each part of the intent (root, targets, period, months, view, chart preference) and the language, of the whole intent (chart included: a request that names no chart expects `auto`; one that writes no name of the Book expects no target), and p50/p95 latency. Each miss prints its trace: every judgment with its score and the rule that fired. Bkper AI caches identical requests for 15 minutes, so only a run after a change measures real latency. Tune the questions, never the expected answers.

## Report spec and catalog

`buildReportSpec(report, lang)` (`server/src/services/report-spec.ts`) turns report data into a json-render spec of the report catalog (`report-shared/catalog`), and validates it before returning it.

- The spec is the standard flat json-render spec (`root` plus an `elements` map of `{ type, props, children?, on? }`), built with `defineSchema`/`defineCatalog` from `@json-render/core`, pinned exactly, without React. Components: `Report` (the root, the only one with children), `Answer`, `Chart` (the main chart; left out when it is the table), `Visualizations`, `BreakdownTable`, `Source`.
- Targets side by side have an `Answer` each (`answer-1`, `answer-2`, …, in order, each labelled with its name), and none for them together; the title is their names as a list in the language (`Intl.ListFormat`, each isolated); the BreakdownTable (labelled `chart_side_by_side`) holds the targets with no `total`; ranked bars and compared are labelled `chart_side_by_side` rather than `chart_breakdown`, so nothing reads as parts of one whole. The catalog is unchanged: several Answers were always valid.
- `Visualizations` (after the Chart in the spec for compatibility; the renderer places previews above the chart; left out when only the main view fits and nothing was asked that does not fit) holds `main` (a `VIEW_KINDS` kind) and `views`: every chart that fits, each with its `kind`, a short localized `name` (`chart_name_*`) and, but for the main one (its data is the Chart's) and `table`, its full `Chart` props, the same a preference for it would draw. A preference that does not fit is `unfit`: its kind, name and `reason`, a localized sentence (`chart_unfit_*`) naming, for a negative part, the row and its amount (formatted exactly with `Intl` and the Book's decimal places), each isolated. It binds `selectChart` (local, the renderer passes the kind).
- `Chart` kinds, each with strict props: `bar`, `line` and `area` (months and series), `stacked` (months and 2+ series without `line`), `ranked-bar`, `donut` and `pie` (items of breakdown rows), `compare` (items with `value` and `previous`, and `periods`: the names of the period and the previous one, for a legend, both absolute and alike: calendar names such as `October 2026` and `September 2026`, the dates of a current period and the same span before, or the dates of two positions; never a relative name like `Last month`) and `waterfall` (`start`, floating `steps`, each with the `rowId` of its row unless it is the rest, and `end`), which the v1 catalog keeps and renderers still draw, though reports no longer give one. Breakdown row kinds `other`, `incoming` and `outgoing` and the Answer's `parts` stay in the catalog likewise, unused. `Source` has `calculated` (`{ label, note }`) for a net result Report calculates. Actions: `expandRow` (local, the renderer passes the row), `selectChart` (local, the renderer passes the kind) and `openInBkper` (only where the renderer can navigate).
- `validateReportSpec` checks the catalog (components, actions, strict props of each element), json-render's `validateSpec` (including unreachable elements), that the root is a `Report`, and that a spec has at most one Chart and one Visualizations, whose `main` is the Chart's kind (`table` without a Chart), each other view carries the data of its kind, kinds appear once, and the unfit kind is not among them. Renderers may call it on specs they receive.
- Every text is resolved in the spec, in the report's language: titles, period labels (`Intl` for years, months and dates, read as UTC calendar dates), comparisons, the note on a net result Report calculates, and every label a renderer shows. Group and account names stay verbatim, also as row labels.
- Values written into a text (a period, a date, a name) are isolated with `isolate` (`report-shared/bidi`, FIRST STRONG ISOLATE … POP DIRECTIONAL ISOLATE), so dates and Latin names read in order in Arabic or Hebrew, and Arabic names in English. Where a text is read as words rather than shown, such as the request in `url`, `withoutIsolates` takes them out. Numbers in texts, like a quarter's, use the language's digits.
- A net result Report calculates has a BreakdownTable `total` row (the net result) under its roots, a chart by month with a series with `line: true` (the net result) over their bars, and the Source's `calculated` label and note. A net result of a combining group is that group's report, titled by its name, with nothing calculated.
- Amounts and ratios stay the report's decimal strings, and months and instants stay ISO; renderers format them with `Intl` in the Report's `locale`, with its `fractionDigits`, in its `dir`.

## API

`server/src/api/routes.ts` adapts HTTP; `server/src/services/report-service.ts` (`createReport`) and `suggestions.ts` (`buildSuggestions`) hold the behavior.

- `GET /api/v1/books/{bookId}/names` — `{ names: [{ id, name, kind, root }] }`: every group and account of the map, each once, in Book order (as `findPromptNames` orders them, `bookNames`), `kind` `group` or `account`, and `root` the root group holding it (itself for a root or an account in no group; the first in Book order for an account under several). Served from the KV snapshot, so up to 60 s old, with the same permission as the suggestions; for completing requests as they are typed.
- `GET /api/v1/books/{bookId}/suggestions?language=` — up to 3 example requests (`SUGGESTION_COUNT`), each with its intent, chosen by fixed rules from the snapshot: the net result, when the Book has one (its combining group is then not suggested again), the busiest Outgoing root by month, the busiest permanent root's position, then other roots, the busiest first (the most months with movements of their accounts in the period: the map holds no amounts). Roots without movements are left out, and periods anchor to the data (this year, or the last year with movements). It also warms the snapshot.
- `POST /api/v1/books/{bookId}/report` — body of exactly one of `prompt` (one Jev decision) or `intent` (no AI, with an optional `chart` preference), with optional `language` and `format`. `spec` (the default) returns `{ spec, intent, language, query, dataAt, chart, trace, url }`, where `chart` is `{ kind, fallback }`: the main chart (`none` for none) and whether the intent's preference did not fit; and `trace` (`ReportTrace`) is `{ judgments?, rule?, names?, facts, chart: { fitting, main, rule, unfit? } }`: for a prompt, each judgment's answer and score, the rule of `SHOW_RULES` that fired, and the Book's names it writes; the report's chart facts, the kinds that fit, the main kind and the rule that chose it, and the unfit preference with its reason code; `html` returns the report file (`text/html`, see Report file), without the trace. Errors stay JSON. The plural `/reports` is kept free for saved or shared reports.
- Order of work: `getUser`, then the KV snapshot (its key needs the user, and Dispatch passes no identity), then Jev, whose options come from the snapshot, then the report's balances queries, in parallel, which need the intent's root and period. Jev answers in ~0.3 s when called often but ~1 s after some idle seconds; that, not the app, is most of the prompt path's p95.
- Language: the `language` field (any BCP 47 tag of a Bkper language, `supportedLanguage`), else the one Jev is sure of, else `Accept-Language`, else `en`.
- `url` opens the request in the Report app (`?book=&q=`), on the preview host when the API was called there, else production. `q` is the prompt, or the report's title and period for an intent.
- Errors use one envelope, `{ success: false, error: { code, message } }`, with the app's own messages, never the prompt or upstream details (`api/errors.ts`): 400 `invalid_request` (naming the field), 401 `unauthorized`, 403 `forbidden` (also for a Bkper 401, its answer to a user who is not a collaborator: the platform has already authenticated the caller), 404 `book_not_found`, 422 `not_a_report` (with `suggestions`), `future_period`, `unknown_root`, `unknown_target` (the client's `error_unknown_target`: a saved or shared target deleted or moved), `mixed_targets` (`error_mixed_targets`: positions and activity side by side) and `no_net_result`, 429 `ai_allowance_exhausted` (Bkper AI `usage_limit_exceeded`), 502 `upstream_error` (Bkper or Bkper AI), 500 `internal_error`.
- `Server-Timing` on every API response: `user`, `kv`, `balances`, `jev`, `compute`, `render` and `total`.

`npx tsx scripts/measure-api.ts [--base=<url>] [--runs=<n>] [--cold=<n>] [--hashtag=<tag>] <bookId>...` times the suggestion-intent, prompt and hashtag paths of a running app (default the local Worker) from `Server-Timing`, read-only, with your `bkper auth token`: `warm` with the snapshot cached and the report's balances read from Bkper, `cached` with both cached, and, with `--cold`, `cold` after the caches expire. Intents vary their period and prompts name a root and a period, so runs read other balances; prompts vary so Bkper AI's 15-minute cache of identical requests is not measured, but a rerun within 15 minutes repeats them.

## Saved prompts

The plural `/api/v1/books/{bookId}/reports` is the Book-shared shelf of original prompts, not computed reports. The singular `/report` remains unchanged and read-only. The client shelf sits just above the fixed bottom input (`components/report-shelf.ts`), remains visible through reports, typing and pending/error states, and replaces the initial suggestions once saved prompts exist. Its single row scrolls sideways instead of growing the footer. Each prompt is its own label (visually truncated, full text accessible), opens through `AppState.openSavedReport` (from memory within a minute, else resolved again), and has a small permission-gated remove action. Save needs one click and uses only the successfully shown report's original prompt; it is disabled while pending, already saved, or transitioning to the next report, and absent without a real source or server save capability. Mutation/list failures stay local to the shelf, with safe retries and an explicit reload for current access; reports and input remain usable.

- `SavedReports` (`client/src/state/saved-reports.ts`) holds the active Book's `items`, server `capabilities`, `loading`, pending `saving` prompt / `removing` id, and separate typed `loadError`, `saveError`, `removeError` reasons (localized by the shelf UI). `canList`, `canSave`, `canRemove` are UI hints, never authorization. `open` resets and reloads on Book changes; `load` retries/coalesces loads. `save()` saves only the shown report's source supplied by AppState, skips already saved prompts and coalesces repeated clicks; `remove(id)` is idempotent. One mutation at a time, confirmed changes merge immediately in id order, and failures leave items intact unless Book access is denied. Mutations invalidate older lists; session guards and abort signals drop late successes/errors even across A → B → A. Later explicit reloads follow KV's eventually consistent view.
- `Reports.originalPrompt` belongs to the successfully shown output, survives chart choices and later typing, and is absent on intent restoration (including cached intents) and prefetched suggestions. Prompt-generated cache entries retain their actual original request, not later casing/spacing. `AppState` supplies this source to `savedReports`; never pass the input or a generated title to Save. With no source, Save is unavailable.
- `AppState.openSavedReport(id)` reads the active shelf item and calls `Reports.runSaved(prompt)`: the client's report of exactly that text from the last `CACHE_MS` (60 s), else a prompt-only singular `/report` request, so after a minute relative periods resolve again. Never a resolved intent or the report of another spacing or casing, so text matching a prefetched suggestion still asks by prompt and the source stays the saved text. A repeated click while it is on its way asks once. Saved executions populate the client caches like typing. AppState starts shelf loads after auth alongside reports and Book details, wires Book navigation and source changes, and leaves first rendering unblocked.

- `GET /reports` returns `{ reports: [{ id, prompt }], capabilities: { list, save, remove } }`. Every known non-`NONE` Book role may list: `OWNER`, `EDITOR`, `POSTER`, `RECORDER`, `VIEWER`. Unknown, missing and `NONE` roles are denied. Listing the shelf grants no balance access: the singular `/report` and `/suggestions` retain their separate VIEWER/POSTER/EDITOR/OWNER allowlist, so RECORDER can list prompts but not compute reports.
- `POST /reports` accepts exactly `{ prompt }` and returns `{ report: { id, prompt } }` (200, also on an identical retry). `DELETE /reports/{reportId}` returns 204 even when absent. Only `OWNER` and `EDITOR` may save/remove, and either may remove any shelf item. These are additive v1 routes; no existing contracts are tightened.
- `services/saved-prompts.ts` performs one fresh, thin `bkper.getBook(bookId)` on **every** read/write before accessing storage. It never authorizes through a cached balances snapshot, the current caller’s billing plan, or client-supplied capabilities. A list’s capabilities describe that request, not future authorization. Shelf responses use `Cache-Control: no-store`.
- Prompts follow the current report-request rules (`services/report-prompt.ts`): trim the edges, 1–1000 UTF-16 code units; preserve internal whitespace, case and language. Nothing is resolved or computed when saving. No HTML, intent, resolved dates, amounts, inferred language or separately selected chart is stored. To reopen, send the saved text as `prompt` to the existing singular `/report`, so relative periods resolve again.
- Storage is the existing app KV binding, one durable key per item: `saved-prompts:v1:<encodeURIComponent(bookId)>:<id>`. `id` is lowercase SHA-256 of the JSON-encoded prompt; the value is only that JSON string (encoding preserves all UTF-16 text). There is no TTL, user partition or whole-list read/modify/write. Identical saves address the same item; independent saves/removals cannot overwrite one another. Listing follows every KV page, checks stored data, tolerates an item removed before reading, and returns stable id order. KV visibility is eventually consistent: a successful write need not appear immediately on another replica; same-item save/remove races follow KV ordering, and a later save can restore a removed item. This is not a linearizable shelf. KV failures return 502 `storage_error`, without prompt/key/upstream details; a failed write may have reached storage, so identical retries are safe.
- Native evidence (paths from `/workspace`): `bkper-core/api/src/main/java/com/bkper/books/savedquery/SavedQueryController.java` lists via `Authorizer.assertCollaboratorOn` and saves/deletes via explicit `OWNER`/`EDITOR` checks; `books/collaborator/Authorizer.java` denies only `NONE` for listing. Native saves additionally check the **owner’s** free plan (`users/user/BkperUser.java:isToBlockSaveQueries`), unlike deletion. That billing restriction is deliberately **not inherited** by app metadata; only the verified Book role model applies.
- Native saved queries are executable (`bkper-clients/packages/pwa/client/src/book/services/query-service.ts`, SDK `Query.getQuery`, canonical `bkper.Query.query`). They have no metadata discriminator and must never carry natural-language prompts. Their native repository uses per-entity transactions (`books/savedquery/SavedQueryRepository.java`), but is not a suitable shelf. Book properties also are unsuitable: `books/book/BookService.java` and `BookEntity.setProperties` replace the entire map, risking lost concurrent changes. The installed SDK types (`node_modules/bkper-js/lib/index.d.ts`, `node_modules/@bkper/bkper-api-types/index.d.ts`) expose `Book.permission`, properties and executable queries, but no owner-plan capability or per-property atomic mutation.
- All mutation tests inject clients and isolated storage and prohibit network access. Never test writes against real Books. No app installation or installation requirement is added.

`npx tsx scripts/verify-saved-shelf.ts` checks the real client in an expanded Book panel (Vite client required). Eight API-stubbed layout scenarios exercise Save and remove failures/retries, saved clicks from memory within a minute and asked again after it (a Playwright fake clock), shelf reloads, read-only capabilities, input/clear/Escape, viewport resize and host text scale at desktop and phone widths, light/dark, English/Arabic, with long multilingual prompts. A ninth scenario bridges two independent browser contexts to the **real** Hono routes and saved-prompt/report services through `scripts/fixtures/saved-workflow.ts`: isolated per-item KV, injected collaborator roles, a made-up Book whose balances queries a fake ledger answers, and injected decision responses. It checks shared reload/reopen, original-text-only storage, a click within a minute asking nothing, fresh resolution on every click after a minute, a November → December clock/snapshot change rolling `last_month` from October to November, cross-Book isolation, role downgrade and access recovery. It writes 61 screenshots to `/tmp/report-saved-shelf` (`--screenshots=<directory>` to override); no live Book or KV reads/writes occur. Only the shared first-paint theme asset is fetched externally.

`test/saved-workflow.test.ts`, part of `npm run check`, uses that same isolated route/service fixture with two independent `AppState` clients and the generated API boundary. It verifies exact deterministic amounts and queries before/after the date change, with a fake client clock: a typed result of the same text answering a saved click, a minute's memory holding a saved report across the date change and resolving it again after the minute, the suggestions' reports fetched again each minute, duplicates across collaborators, chart/draft source safety, intent-only restoration with no savable source, Book isolation, fresh role checks despite stale client capabilities, RECORDER shelf reads without granting balance/report access, storage-error retries and access recovery. The existing store tests cover delayed responses, cancellation and A → B → A navigation. All fixture writes are in-process; global network is prohibited. These tests prove application behavior, not platform authentication, native Book menu integration, real wall-clock or Worker KV expiry, or cross-user visibility/order on deployed eventually consistent KV. Test those separately only with approved release fixtures; never point mutation tests at existing Books or live KV.

## Report state

`report-shared/report-state` writes a report as the opaque app state Bkper keeps in a Book's URL (`appState`, at most 128 of `A–Z a–z 0–9 _ -`), so a link, Back or a reload opens it again: `encodeReportState({ intent, language? })` and `decodeReportState(state)`. The intent's values (`REPORT_VIEWS`, `REPORT_CHARTS`, the period ids, the hashtag rule and limits) live in `report-shared/report-intent`, which the Worker's `ReportIntentSchema` uses too.

- A version, `1`, then the base64url of the UTF-8 of `<monthly><view><chart>.<period>.<language>.<hashtags>.<root>`: one letter each for the month flag, the view and the chart (`VIEW_CODES`, `CHART_CODES`, never to be reused), hashtags joined by `,` (neither `.` nor `,` can be in one), and the root group's id last, which stays valid when the group is renamed. No chart and `auto` are written alike.
- A report of a target is version `2`, `….<hashtags>.<target>.<root>`: the target's id before the root's, so it cannot hold a `.` (Bkper ids are digits). Reports without one stay version `1`, byte for byte, so every state written before opens the same report, and older clients read a `2` as no state. Two 16-digit ids with long hashtags still fit 128 letters.
- Targets side by side are version `3`, `….<hashtags>.<alongside>.<target>.<root>`: the others joined by `,`, each `<root>` or `<target>:<root>` (their ids cannot hold `.`, `,` or `:`), then the first target (empty for a root) and its root as in version `2`. Two 16-digit targets with their roots fit 128 letters; three do not, and give no state. Version `1` and `2` states are written and read as before; older clients read a `3` as no state.
- Encoding gives `undefined` when the state would be longer than 128 or the intent is not one decoding accepts. Decoding validates every field as the API does and accepts only a state it writes itself (it encodes the result again and compares), so any other value is no state.
- The report file carries the state of its report (`open`), and of the same report as each other chart that fits (`open.charts`, the intent with that `chart`), and the web client sends and reads it in a Book and keeps it in its own URL (see Web client). A chart chosen from the previews is the report's state with that chart, so reopening shows it.

`npx tsx scripts/verify-open-in-report.ts [--app=<url>] [--api=<url>] [--intent=<json>] <bookId>` checks opening a report from the Agent end to end (the Book's first suggestion, or `--intent`, such as a target's, whose state is version `2`), read-only, with your `bkper auth token` and the app running locally (`npm run dev`): headless Chromium plays the Book and the Agent at their origins, as bkper-clients implements them, with the real report file from the local API and the real app in the Book's panel. It chooses a chart from the file's previews, then checks that the chart shows in the file with nothing sent or loaded, that a click on the file's link opens the Report app in place of the Agent with the state of the report as that chart, that the app shows that report by intent, as that chart, with its title and period in the input, that choosing another chart in the app sends its state to the Book once and asks for no report, that choosing another report sends its state to the Book once, that a state the Book goes back to shows its report again without being sent back, and that the file reaches no network and nothing logs an error.

## Docs for people and agents

`README.md` is the listing page people read (`bkper app get report` shows it too): what Report does, how to open it, examples in several languages, the previews of every chart that fits, the charts one can ask for, when each fits and why one shows dimmed, opening a report from the Agent, what it reads, and its limits. Keep development notes here, not there.

Agents decide from `bkper app list -b`, `bkper app get report` and `bkper app api spec report`, so the OpenAPI texts are written for them: the document's `info.description` (`server/src/api/openapi.ts`) is the guide, and each route, field and error repeats what an agent needs where it reads it (`routes.ts`, `schemas.ts`). The call they lead to: `POST /api/v1/books/{bookId}/report` with `{ "prompt": <the person's words, in their language>, "format": "html" }`, its output saved to an `.html` file the agent publishes. `bkper app api request` prints only an error's `message`, so messages say what to do next (`api/errors.ts`), never the request.

`npx tsx scripts/check-agent-docs.ts [--spec-url=<url>/openapi.json] [--model=<id>]` gives only the README, the listing and the OpenAPI document (this folder's, or a running app's) to a Bkper AI language model playing a fresh agent, asks it for the commands it would run for report requests in four languages, and checks them (`scripts/agent-docs/plan.ts`): the report call on the Book, the request in its own words, `format: html`, the file saved and published, nothing that changes the Book. Nothing runs and no Book is read. Rerun it after changing the README, the listing's `description` or the OpenAPI texts.

## Report renderer

`<report-view>` (`client/src/report/`, entry `index.ts`) renders a report spec with Lit and Web Awesome Pro: answer first, then chart previews when offered, the chart, the breakdown table and the source, in the spec's `locale` and `dir`. Set its `spec` property. Where the spec offers `Visualizations` and binds `selectChart`, the previews go where they are, followed by the chart shown, so changes in chart height leave the previews in place; its `chart` property is the chart shown (by default, and for a kind the spec does not offer, the main one; a new spec starts at its main one unless its host sets `chart` with it).

- The previews (`preview.ts`): a toolbar above the chart of tiny SVG drawings of every chart the spec offers, in its order, each from the spec's numbers (the main one from the Chart) in the chart's colors, with no labels, axes or tooltips, a short name under each (`name`); the unfit kind is a sketch of its shape in the text's color. There is no Table card: the breakdown table always stays below the chart. `table` remains in the public spec, intent and state contracts, and table-only reports still show no chart until one is chosen. The chart shown is pressed (`aria-pressed`) and alone in the tab order; without a chart, none is pressed and the first chart preview is in the tab order; the arrow keys move between them in the report's direction, Home and End to the ends, and a click, Enter or Space shows one in place of the chart, at once, from the data the spec carries, with no network (~20 ms in Chromium), and fires `report-select-chart`. The chart asked for that does not fit (`unfit`) comes first, dimmed and `aria-disabled`, with its reason visible and in its accessible name; it does nothing. They wrap on wide reports and scroll sideways on narrow ones (`max-width: 40rem`); drawings run from the inline start, so they mirror in right-to-left reports. The table's swatches follow the chart shown.

- The Source shows a `calculated` label and note first among its facts (`.source-calculated`), in the app and in report files.
- Self-contained: no app state, no network, and only type imports from `report-shared/catalog` (its validation code is large; the server validates every spec), plus the tiny `report-shared/bidi`. It registers the Web Awesome charts and sparkline it uses; the page provides the Web Awesome theme and `@bkper/web-design` tokens. So the web app and a standalone report file can bundle it alone.
- `format.ts` formats the spec's decimal strings exactly with `Intl` (never through floats); `ReportFormat.plot` gives the numbers charts draw. Charts' tooltips show the exact amounts, name and amount each isolated. A share never shows as a signed zero: a share too small to show, other than zero, reads `<0.1%` in the locale's digits.
- `chart-config.ts` builds the Chart.js configuration of every chart kind, for `wa-bar-chart`, `wa-line-chart`, `wa-doughnut-chart` and `wa-pie-chart`. Colors are the Bkper type color tokens (`--bkper-color-<color>-<low|medium|high>`, the palette of Bkper's charts), so they follow the light or dark theme; a donut, a pie and stacked parts shade items of one color from high to low (`shades`). Ranked bars of negative values go the other way from zero, in their type's color, with room past zero (`grace`) and a minimum length, so a tiny value, such as a small overdraft, still shows.
  - By month: `bar` (bars), `line` (a line), `area` (each series filled from zero, the net result's `line` series a line over them, on an axis from zero) and `stacked` (stacked bars, a shade per part, a line of the surface between parts). Lines and areas keep half a month from the chart's edges (`offset`), so the first and last months' labels show whole in either direction.
  - `compare`: horizontal bars in pairs, the previous period first, outlined (a light fill and a border), and this period solid, so they differ in more than color; the legend names both periods. A zero draws no bar.
  - `waterfall` (in the v1 catalog; reports no longer give one, so its tests read the recorded `client/test/report/waterfall-specs.json`): floating horizontal bars in `wa-bar-chart` (Chart.js `[start, end]` data, positions in display floats only; the exact amounts are in the tooltips). The start and end stand on zero, solid in the strong tone; a step up is solid, a step down outlined. A small Chart.js plugin of the config (`barLabelsPlugin`) writes each bar's value (`barLabels`) past its end, steps with their sign (`signedCompact`), in the ticks' font and color, and past its other end when it does not fit in the chart, so labels never cover the names.
  - `chartSwatches` gives the colors of the rows a chart draws as items or series of their own (ranked bars, donuts, pies, comparisons and stacked parts), the table's swatches.
- Several Answers (targets side by side) show together where the first is, in a row that wraps (`.answers`), each with its label. In charts by month, series of one type color get tones of their own (`seriesTones`: the first in its usual tone, the others lighter), so targets side by side stay apart; the legend names them.
- Values the renderer places next to texts (amounts, changes) are isolated with CSS (`unicode-bidi: isolate`) and inherit the report's direction; texts of the spec carry their own isolates.
- The breakdown is a plain table with disclosure buttons, not `wa-data-grid`: the grid would more than double the renderer's size (about 600 KB minified) and it would hide the row hover the chart follows. `wa-icon` fetches its SVGs, which a strict content security policy blocks, so the chevron is inline SVG.
- Rows open in place when the spec binds `expandRow`. Hovering or focusing a row, or else the row opened last, highlights it in the chart: its top-level item in a breakdown chart or a comparison, its series in a net result, the part it is in when parts are stacked, its steps in a bridge (a row that holds steps, such as Outgoing, also highlights the rest of them), or its months added to another chart by month; the rest fades. A row the chart does not draw (no amount in the period) highlights nothing. The table's swatches are the legend of the rows the chart draws.
- A series with `line` is drawn as a line over the bars of `wa-bar-chart` (Chart.js mixed datasets, no extra component). The table's `total` is a `tfoot` row.
- Events (`events.ts`), bubbling and composed: `report-expand-row` (`{ rowId, expanded }`), `report-select-chart` (`{ kind }`, the chart chosen from the previews) and `report-open-in-bkper` (`{ url }`, cancelable: cancel it to navigate another way). The link to Bkper shows only when the spec binds `openInBkper`; a host that cannot navigate sets `link` (`{ url, label }`) instead, a plain link in the Source.

`http://localhost:5207/dev/report.html` is a development-only gallery of recorded specs (`?only=<id>,…`, `?width=<css length>`; the `bkper_theme` cookie picks light or dark). `npx tsx scripts/generate-report-specs.ts` rebuilds those specs (`client/dev/specs/*.json`, which the renderer tests read) with the real report and spec builders from made-up Books shaped like recorded payloads: `scripts/fixtures/studio-book.ts`, a balanced design studio whose net result Report calculates, and the server test Book, whose net result is its combining group, with a refund that puts Food below zero. Rerun it when the report data or the spec changes. With Book ids it reads live Books, read-only, into `client/dev/specs/local/`, which Git ignores so real Book data is never committed.

## Report file

`format: "html"` returns one self-contained HTML file of the report, for the Bkper Agent, which shows a published HTML file in an `<iframe sandbox="allow-scripts">` whose `srcdoc` starts with its Content-Security-Policy (`default-src 'none'`, inline scripts and styles only; bkper-clients `packages/agent/client/src/file-views.ts`). So the file loads nothing: no network, fonts or icons.

- `npm run build:report-file` (`client/vite.report-file.config.ts`) bundles `client/src/report-file/` alone, the renderer with the Web Awesome theme and `@bkper/web-design` tokens, into one classic script and one stylesheet, written as `server/src/generated/report-file-bundle.ts` (Git and Prettier ignore it). The build fails if either holds text that would end its inline element. `postinstall`, `dev`, `build` and `check:generate` run it before anything imports the server; rerun it after changing the renderer while `npm run dev` runs.
- `buildReportFile(spec, link)` (`server/src/services/report-file.ts`) writes the document around that bundle, held in the Worker's memory: `lang` and `dir`, `<meta charset>`, the same policy, a `<title>` of the report's title and period, and the data (`ReportFileData`, `report-shared/report-file`) as a JSON script with `<`, U+2028 and U+2029 escaped. Nothing is bundled per request; `render` in `Server-Timing` includes it.
- The file cannot open Bkper in place, so the Source drops `openInBkper` and links to the same report in the Report app (the response's `url`, `source_open_in_report`). The file also carries the Book and the report's state (`open`, left out when the state does not fit); once the window around it says `bkper:host-ready` with `navigate` in `supports` and the Bkper `origin` (any web origin: the Agent checks the link again; as the Bkper Agent tells the files it shows, from the parent window only), a plain click on that link sends `bkper:navigate` to `<origin>/books/<bookId>/transactions?app=report&appState=<state>` instead (`followFileHost`), so the Book opens the report in the Report app in place of the Agent. The Agent passes it on only while the file's frame has focus, as it does after that click, and tells the file `bkper:host-ready` again when the Book starts accepting navigation after the file loaded. Until then, it stays a plain link that opens a new tab; only a click sends anything. The file follows the viewer's light or dark color scheme (`prefers-color-scheme`); rows open in place and charts show tooltips offline.
- The previews work offline in the file: choosing one changes nothing outside it, and its link and `bkper:navigate` then open the report as that chart (`chosenReport`: the state of `open.charts`, also as `&state=` on the plain link; the file's own link and state for its main chart).
- The bundle is ~357 KB and stays under 400 KB (a test); the Agent shows HTML files up to 1 MB, so report data has the rest.

`npx tsx scripts/verify-report-file.ts [--screenshots=<dir>] [--width=900] [<file.html>...]` opens report files in headless Chromium exactly as the Agent frames them, with every request blocked, and fails on any request, policy violation or console error, or when the answer, the chart, its tooltip, the link or opening a row do not work, or when a value isolated in a text (and the ends of an isolated date range) does not read in the report's direction, measured on screen, or when a click on a preview does not show its chart in place of the main one (drawn, pressed, with no request) or the link does not then carry its state, or when the link sends anything before the Agent's `bkper:host-ready` or without a click, or other than one `bkper:navigate` to the state of the chart chosen after them; in light and dark. It also checks that there is no Table preview, Tab reaches the toolbar even on table-only reports, arrow keys follow the report's direction, Home and End reach the ends, previews stay above the chart at the same position when switching (including a different-height monthly-to-round-chart regression), and the breakdown stays below it. Use `--width=390` for narrow reports. It reports how long each chart took to show, from the click to its first frame, and the change in chart height. Recorded files carry a made-up state with one per chart (`reportFileOpen`). The Agent's page is served at its origin, so the file hears it as the Agent. Without files it writes one per recorded spec; files saved from the local Worker end with the live-reload script `bkper app dev` adds to HTML, which it leaves out. It needs Playwright's headless shell: `npx playwright-core install chromium-headless-shell`.

## Web client

The app has one layout everywhere, in a Book's panel (`menuOpenMode: EXPANDED`, over the transaction list) or opened directly (`components/report-page/`): the report scrolls above an input fixed at the bottom, and morphs in place; notices and the suggestions (chips, when the input is empty) sit just above the input.

- The input matches the Book's transaction input measure for measure (bkper-clients `transaction-record-view.ts` and `transaction-record-css.ts`): a pill `wa-input` in a bar `3.75rem` high (padding medium above, small at the sides; the input padded 2x-small above) at the top of a footer `5.1875rem` high, with `--bkper-border`, the default placeholder and Web Awesome's clear button (`with-clear`, shown while there is text; it clears the request and keeps the focus). `styles.css` applies Bkper's density (`--wa-space-scale: 0.9`, `--wa-font-size-scale: 0.92` from 768px), as the Bkper page does, so the sizes match. Check it against the Book after changing either.
- The input shows, focused, in the app's first frame, and never moves: what sits above it grows upwards, and the report changes inside the scroll area. Enter asks at once (`enterkeyhint="send"`), Escape clears the request; while names of the Book show (see Completing names), Enter accepts only a highlighted name and Escape first dismisses them.
- With a Book in the URL there is no Book picker and no breadcrumb. Without one, the Book picker (or its loading or error) shows above a disabled input.
- `VisualViewportController` (`components/report-app/visual-viewport.ts`) sizes the app to the visual viewport, so on phones the input stays above the on-screen keyboard; `index.html` asks Chrome to resize the page for it (`interactive-widget=resizes-content`).
- In a Book, the report on screen keeps its state (see Report state) in the Book's URL: `bkper.yaml`'s menu URLs pass it as `&state=${app.state}`, and a missing or empty value, or the expression left unreplaced by older Bkper versions, is no state. A valid state opens its report by intent, without Jev, over any `q`, and the input then shows its title and period (`reportText`). Once the Book's `bkper:host-ready` lists `app-state`, each new report sends `bkper:app-state { state }` (empty when its state does not fit) and keeps it in the app's own URL; a report whose state the URL already has sends nothing. A chart chosen from the previews (`Reports.chooseChart`, from `report-select-chart`) is the report's state with that `chart`, sent the same way; the main chart again is the report's own state. A `bkper:app-url-changed` of another state shows that report; of the same Book without one, nothing changes. `BookHost` (`state/book-host.ts`) hears only the parent window on a Bkper origin (`bkper-host.ts`: production and development, and Bkper run locally only for the app run locally) and sends only to the origin of the last `bkper:host-ready`. Standalone, the app's URL keeps the same state (`?book=&q=&state=`), so a reload opens the report on screen, as the chart chosen.
- Embedded, the light or dark theme follows `bkper:theme-changed` through the first-paint theme script, and the text scale follows `bkper:font-scale-changed` (`host-font-scale.ts`, `--wa-font-size-scale`, 0.5–2), both only from the parent window.

Without a Book in the URL, the app shows the Book picker (`components/book-picker.ts`): the person's Books changed most recently (`lastUpdateMs`, sorted by the `Books` store), at most `RECENT_BOOKS` (8), and, when they have more, a field that finds any of them by every word typed, ignoring case and accents (`findBooks`); Enter opens the first. Its texts, the loading state and the errors of the `Books` store (string keys) come from the strings, in the interface's language and direction; Book names keep their own direction.

The Book page is one input, with no submit button, and the report above it. Its behavior lives in the `Reports` store (`state/reports.ts`), the input controller, which the unit tests cover:

- A request goes out `DEBOUNCE_MS` (250 ms) after the last keystroke once it has `MIN_WORDS` (2) words, counted with `Intl.Segmenter` so languages written without spaces count too; Enter asks at once. A newer request aborts the one in flight (`AbortController`), and an answer to any but the latest request is dropped (a sequence id).
- The last report stays on screen while the next is on its way, with a thin progress line under the input that appears only when the wait is felt; the page changes into the next report with a view transition scoped to the report (`Element.startViewTransition`), over the whole page where only document transitions exist, and without one otherwise or under reduced motion.
- Reports are remembered in memory per Book for `CACHE_MS` (60 s, `state/cache-window.ts`) from when they were asked, by request (whitespace runs as one space, case kept: it tells apart names of the Book written alike but for case) and by intent (with its target, its targets alongside in order, language and chart; no chart is `auto`), saved requests too; failures are forgotten, and so is everything on another Book. After a minute a request asks again (the report on screen stays until it answers), so relative periods advance; with the Worker's 60 s balances cache, a report can be up to two minutes behind the Book; an answer that arrives late shows but is not reused. The clock is `Date.now` (it runs through sleep; a clock that went back expires everything), injectable as `now` in `AppState` and `Reports`. The chart chosen for the report on screen (`chart`) holds that report, so another report shows its main chart in the same change. When the suggestions arrive, their reports are fetched by intent (no AI) and remembered under their texts too, so choosing or typing a suggestion shows it from memory. The suggestions come from the Book's map, which the Worker keeps for the same 60 s: the first request after a minute asks them again, once, in the background; the ones shown stay until new ones arrive, and stay without a notice when that fails (asked again a minute later), and their reports are fetched again.
- Before the Book has saved prompts, suggestions show as chips in the shelf over the input, including while viewing a report or typing, fading in when they arrive. Once saved prompts exist they take the suggestions' place. The report notices answer: `not_a_report` (a quiet hint; the last report stays) and `ai_allowance_exhausted`. Other failures show a short message from `shared/catalog/en.json`, never the error (`no_net_result` says to add a group that combines income and expenses). One message shows at a time: a Book that cannot be read shows the API's reason (`book_not_found`, `forbidden`), else that its details did not load (`error_book_load`).
- `route.ts` alone keeps the request in the URL (`q`), replacing the entry as the person types; opening a URL with `q` runs it at once. It keeps the report's state (`state`) the same way, and follows the app URLs Bkper sends (`follow`). Another Book drops both.
- Completing names (`BookNames`, `state/book-names.ts`; the index in `report-shared/name-index`): `AppState` opens the Book's names with its reports once signed in, in the background (`GET /names`), never before first rendering. `complete(text, caret)` reads only memory: no request per keystroke. The names come from the Book's map, which the Worker keeps for `CACHE_MS`: on the reports' changes (typing), `refresh()` asks again once they are older than a minute, keeping the names known until new ones arrive (the index is rebuilt only when they changed) and when that fails (asked again a minute later); a Book that can no longer be read (`forbidden`, `unauthorized`, `book_not_found`) forgets them. Another Book starts over; session guards and abort signals drop late answers, even across A → B → A. `NameIndex` completes the end of the request at the caret, from a word boundary on, once it is 2 folded characters (`MIN_COMPLETION_LENGTH`), when the caret ends a word and is outside `#hashtags`: names that start with that text, or with a word that does (no fuzzy or in-word matches), ranked by the most of the text completed, then names that start with it, then the shortest, then Book order, at most `MAX_COMPLETIONS` (5). Each completion is `{ name, text, from, to }`: `text` (the Book's name, whitespace collapsed and trimmed) replaces `from`–`to` (the caret). It offers only what the Worker then reads as that name: never one character, of names written alike the one the Worker reads, not a name already written exactly, and each completion is checked with `matchNames` against the request it makes, so a name a longer one would swallow (Card after "credit" when the Book has Credit Card) is not offered. `server/test/services/prompt-names.test.ts` checks every completion of every prefix of every name in several contexts against `findPromptNames`.
- The input shows the completions as a list-autocomplete combobox (`components/report-page/name-completion.ts`, `NameCompletionController`; drawn by the page): a `wa-popup` listbox over the report, anchored to the top of the dock (`top-start`, never flipped), so it never covers the input, the saved shelf or a notice, measured like the Book's input suggestions (a Web Awesome dropdown's), each name in its own direction (`bdi`) with a localized Group or Account tag (`completion_group`, `completion_account`), each option as tall as a form control for touch. The `<input>` inside `wa-input` keeps the focus and is the combobox: `role`, `aria-autocomplete="list"`, `aria-expanded`, and, as the listbox lives in the page's shadow root, `ariaControlsElements` and `ariaActiveDescendantElement` (element references, which reach into a shadow-including ancestor; ids cannot). Nothing is highlighted at first. Tab (or a click or tap, which keep the focus and the on-screen keyboard) accepts the highlighted name, else the first; ↑/↓ browse, wrapping; Enter accepts only a highlighted name, else closes the list and runs the report; Escape dismisses the list, and only then clears the request. Accepting writes `applyCompletion` (`report-shared/name-index`) synchronously into the input: the name replaces only the text it completes, the rest of the request stays as typed, the caret goes after the name (and a space when the name ends the request), and `Reports.input` takes the new request, so the debounce asks for its report as for typing. After accepting or dismissing, nothing shows until the person types or moves the caret (arrow keys, Home, End, a click). Completions follow the caret, close when the input loses focus or its text changes elsewhere (a suggestion, a saved prompt, the clear button), and appear when names arrive while typing. While an input method composes (`compositionstart`–`compositionend`, `isComposing`, Safari's key code 229) nothing completes and keys are the input method's.

`npx tsx scripts/verify-completions.ts [--screenshots=<dir>]` checks the completions in the real client in an expanded Book panel (Vite client required; the API stubbed with a made-up Book of 25,000 multilingual names, no Book, Worker or KV read), at 1100 and 390 px (touch), light and dark, English and Arabic: every keystroke that should show names, timed from the key to the frame after they show, under 50 ms (with a Book of 25,000 names all alike, too); the list above the dock, never over the input or the shelf, starting where the input starts in either direction; the combobox's state and Playwright's ARIA snapshot of the page; the keys; insertion at the caret keeping the rest; several names; an input method composing (Chrome DevTools Protocol); a click or tap keeping the focus; the debounce asking for the completed request; the clear button and a saved prompt working while names show. Measured locally in headless Chromium with the Vite dev client: p50 about 29 ms, p95 about 31 ms, slowest under 40 ms, of which about two frames are the browser's own (a key, then the frame drawn). It writes 32 screenshots to `/tmp/report-completions`.

`npx tsx scripts/measure-names.ts [--sizes=1000,10000,25000] [--requests=200]` times building the index and completing every keystroke of typed requests on made-up multilingual Books, and on Books whose names are all alike (every keystroke matches every name), with no network. Measured locally in Node on a loaded 8-core machine, for 1,000 / 10,000 / 25,000 names: keystrokes p95 about 0.2 / 0.3 / 0.4 ms (all alike: 0.2 / 1 / 3.5 ms; the slowest under 30 ms); building the index about 10 / 50 / 85 ms, once per Book and again only when its names change. Headless Chromium on the same module: 25,000 names build in about 80 ms, keystrokes p95 about 1 ms.
- `AppState` opens the reports of the Book in the URL once signed in, and preloads the report renderer (`report-loader.ts`, a code-split chunk with the charts) as the app connects, so the shell and the input show first. The interface language is the browser's when Bkper has it, else English; suggestions and the reports they ask for use it, while a typed request gets the language the server detects.

## Strings

`shared/catalog/en.json` holds every UI and report string: key → `{ text, role, context, placeholders? }`. Placeholders are named, `{name}`, and each is documented in `placeholders`; a test enforces both. Write `context` for a translator who sees nothing else: where the string appears, what it means in Bkper, and how short it must be.

`t(key, lang, params)` (`report-shared/strings`) reads a language added with `addLocale(lang, messages)` (a flat `key → text` map), then its base language (`pt-BR` → `pt`), then English; blank texts fall back too. Params fill placeholders verbatim, so format numbers and dates before passing them; a placeholder without a value stays visible. `textDirection(lang)` gives `rtl` for right-to-left languages (a test checks it against each language's script).

`shared/locales/{lang}.json` holds the strings of each of the 133 Bkper languages, generated and committed; never edit `en.json`, which is the catalog's English. A string added before `npm run translate` runs is written in English into every locale, with no hash in `scripts/translate/sources.json`, so it shows in English and the next run translates it. How they load:

- The Worker imports all of them statically (`report-shared/locales`, `addAllLocales()` in `server/src/index.ts`), so reports and suggestions are written in any language.
- The browser loads only the interface's language, a chunk of its own (`report-shared/locale-loader`, `loadLocale`), through the `Strings` store (`client/src/state/strings.ts`): the interface shows in English at once and in the person's language when its strings arrive. Components write their texts in `strings.language`.
- A report file carries no strings: its spec has every text resolved in the report's language.

`npm run translate` (`scripts/translate.ts`) translates with a Bkper AI language model (`claude-sonnet` by default, the model of Bkper's own interface translations, with strict JSON output), with your `bkper auth token`, labelled `bkper-ai-source: report-translate`. Each call is one key and up to 44 languages (`--batch`; a strict answer for all 132 at once is more than the model accepts), with the key's text, role, context and placeholders, each language's tone (`scripts/translate/tones.ts`) and the Bkper words the text uses (`scripts/translate/glossary.ts`), both copied from bkper-clients `packages/translations`; the instructions are `scripts/translate/prompt.md`. Every text is checked before it is written (`scripts/translate/translation.ts`: placeholders exactly as in English, Bkper kept, not empty, not quoted, no line breaks, no explanations). It is incremental: `scripts/translate/sources.json` holds a hash of each text's source (English, role, context, placeholders, glossary words, tone), so a run translates only missing texts and keys whose source changed; `--keys`, `--languages` and `--force` redo chosen ones. Up to 8 calls run at once (`--concurrency`), with retries. Each run also writes `shared/locales/en.json` and the two loading modules (`shared/src/locales.ts`, `shared/src/locale-loader.ts`). After adding or changing a string, run it and review the new texts of a few languages; `shared/test/locales.test.ts` fails until every language has every key.

## Web Awesome Pro

The client depends on `@awesome.me/webawesome-pro`, pinned exactly, from `https://npm.webawesome.com/`. Import components and themes from `@awesome.me/webawesome-pro/dist/...`, never from the free `@awesome.me/webawesome` package. The Agent Skills under `.agents/skills/` are synced from the Pro package and include its Pro components, such as the charts and data grid.

The committed `.npmrc` contains only the registry and `${WA_TOKEN}`. Each developer uses their own token:

```bash
export WA_TOKEN="$(cat ~/.config/webawesome/token)"   # or your own token source
npm install
```

Never print, log or commit the token. Without it, `npm install` fails with `E401` from `npm.webawesome.com`.

## Local development

| Process | Port |
| ------- | ---- |
| Vite client (`npm run dev:client`) | `5207` |
| `bkper app dev` Worker (`npm run dev:server`) | `8809` |

Both ports are strict and assigned in the bkper-apps monorepo's port table; keep `client/vite.config.ts` and the `dev:server` script aligned.

`http://localhost:5207/dev/bar-chart.html` is a development-only page that checks Web Awesome Pro charts load and render. It is not part of the production build.

## Resources and routes

| Resource or behavior | Route or implementation |
| -------------------- | ----------------------- |
| API health/ping | `GET /api/v1/ping` |
| Suggested reports of a Book | `GET /api/v1/books/{bookId}/suggestions` |
| Names of a Book's groups and accounts, to complete requests | `GET /api/v1/books/{bookId}/names` |
| A report of a Book | `POST /api/v1/books/{bookId}/report` |
| Book-shared saved prompts and role capabilities | `GET /api/v1/books/{bookId}/reports` |
| Save/remove original prompts (app metadata only) | `POST /api/v1/books/{bookId}/reports`, `DELETE /api/v1/books/{bookId}/reports/{reportId}` |
| OpenAPI contract | `GET /openapi.json` |
| Static client | Worker fallback backed by the `ASSETS` binding |
| Platform storage | `KV` service binding |
| Book menu | `bkper.yaml` `menuUrl`: `https://report.bkper.app/?book=${book.id}&state=${app.state}` |

## Current implementation structure

```text
client/src/
├── index.ts       — Browser entrypoint
├── web-awesome.ts — Web Awesome Pro component registration for the client UI
├── components/    — Lit features with co-located view and CSS: the app shell, the Book picker, the Book page, the suggestions
├── state/         — Stores: URL (route), Books, report input/output and provenance (reports), shared prompt shelf (saved-reports), the Book's names to complete (book-names), and wiring (app-state)
├── report-loader.ts — Loads the report renderer's code-split chunk
├── auth/          — @bkper/web-auth session boundary
├── services/      — bkper-js orchestration for the browser
├── api/           — Typed /api/v1 client and generated OpenAPI types
├── report/        — <report-view>: the self-contained report renderer
└── report-file/   — The report file's script and page styles, bundled alone for the Worker
client/dev/        — Development-only pages served by vite dev, and recorded report specs

server/src/
├── index.ts      — Worker composition, middleware, health, static assets
├── api/          — HTTP API routes, OpenAPI schemas, API error responses
├── services/     — App behavior and Bkper SDK orchestration
└── generated/    — The report file bundle (`npm run build:report-file`, not in Git)

shared/
├── catalog/en.json  — English strings with translator context
├── locales/         — Generated strings of every Bkper language (`npm run translate`)
└── src/
    ├── catalog.ts   — json-render report catalog, spec types and validation
    ├── strings.ts   — t(key, lang, params) with English fallback
    ├── bidi.ts      — Isolates values written into texts of any direction
    ├── locales.ts, locale-loader.ts — Generated: every language for the Worker, one at a time for the browser
    ├── languages.ts — The 133 Bkper languages, with native and English names
    ├── report-file.ts — The data a report file carries for its script
    ├── report-intent.ts — The values an intent may hold (views, charts, periods, hashtags)
    ├── report-state.ts — A report's compact state, for the Book's URL
    ├── names.ts     — How a request writes a Book's names: the Worker finds them and the client completes them by it
    └── name-index.ts — Completing names as a request is typed, from an index of the Book's names
```

## Key files

| Task                       | File                                                    |
| -------------------------- | ------------------------------------------------------- |
| Add UI rendering           | `client/src/components/report-app/report-app-view.ts`   |
| Change the Book picker     | `client/src/components/book-picker.ts`                  |
| Change the Book page       | `client/src/components/report-page/`                    |
| Change how typing asks for reports | `client/src/state/reports.ts`                |
| Add shared client state    | `client/src/state/`                                     |
| Change what the URL holds  | `client/src/state/route.ts`                             |
| Add Bkper client behavior  | `client/src/services/book-service.ts`                   |
| Add typed client API calls | `client/src/api/app-api.ts`                             |
| Configure client dev/build | `client/vite.config.ts`                                 |
| Add API schemas            | `server/src/api/schemas.ts`                             |
| Add API endpoints          | `server/src/api/routes.ts`                              |
| Add server behavior        | `server/src/services/`                                  |
| Change how a report request runs | `server/src/services/report-service.ts`           |
| Change the suggestions     | `server/src/services/suggestions.ts`                    |
| Change saved-prompt persistence and role authorization | `server/src/services/saved-prompts.ts` |
| Change the client saved-prompt shelf and pending/error state | `client/src/state/saved-reports.ts` |
| Change API error mapping   | `server/src/api/errors.ts`                              |
| Change periods or dates    | `server/src/services/periods.ts`                        |
| Change the report intent   | `server/src/services/report-intent.ts`, `shared/src/report-intent.ts` |
| Change a report's state    | `shared/src/report-state.ts`                            |
| Change what the app tells the Book | `client/src/state/book-host.ts`, `client/src/bkper-host.ts` |
| Change the Book snapshot (map) | `server/src/services/snapshot.ts`, `snapshot-loader.ts` |
| Change a report's queries or calculation | `server/src/services/report.ts`          |
| Change how balances are read or cached | `server/src/services/balances.ts`, `balances-loader.ts` |
| Change intent questions or thresholds | `server/src/services/intent-questions.ts`    |
| Change how answers become an intent | `server/src/services/intent-resolver.ts`       |
| Change how a request's names are found | `server/src/services/prompt-names.ts`, `shared/src/names.ts` |
| Change how names are completed | `shared/src/name-index.ts`, `client/src/state/book-names.ts`, `client/src/components/report-page/name-completion.ts` |
| Add a Server-Timing metric | `server/src/services/timing.ts`                         |
| Change the report spec     | `server/src/services/report-spec.ts`                    |
| Change how reports render  | `client/src/report/`                                    |
| Change the report file     | `client/src/report-file/`, `server/src/services/report-file.ts` |
| Rebuild the recorded specs | `scripts/generate-report-specs.ts`                      |
| Change report components   | `shared/src/catalog.ts`                                 |
| Add or change a string     | `shared/catalog/en.json`, then `npm run translate`      |
| Change how strings are translated | `scripts/translate.ts`, `scripts/translate/`     |
| Regenerate API types       | `npm run api`                                           |
| Change the docs agents read | `README.md`, `server/src/api/openapi.ts`, then `scripts/check-agent-docs.ts` |
| Configure app              | `bkper.yaml`                                            |
<!-- APP_SPECIFICS:END -->
