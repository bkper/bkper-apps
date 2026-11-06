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

- **Client**: Lit + Web Awesome Pro; a Book picker and, for the selected Book, one input whose report builds as the person types, with the Book and the request in the URL as `?book=<bookId>&q=<request>`.
- **Server**: Hono Worker serving typed OpenAPI `/api/v1/*` routes. No `/events`: the app only reads Books and never changes them.
- **Shared** (`shared/`, package `report-shared`): the report catalog, the strings, bidirectional text and the Bkper languages, imported by both the server and the renderers. It holds only environment-neutral code (no DOM, Worker or Bkper SDK), so browser bundles never pull server code.

## Accounting rules

- Numbers come only from deterministic code over Bkper balances. AI may choose among options the code offers; it never computes amounts or dates, and never writes queries.
- Read-only on Books: never create, update or delete anything in a Book, and do not subscribe to events.
- Periods resolve to ISO dates in the Book time zone: `after:` inclusive, `before:` exclusive. Only "today" reads the clock. A request that names no period reads activity (Incoming, Outgoing) for this year, positions (Asset, Liability) today, and a trend over the last 12 months; when this year or those 12 months have no movements in the report's groups, it reads the last year that has them (`defaultPeriod`), so Books with old data still show their data. Current periods (this month, quarter and year, year to date, the last 12 months, all time) end at tomorrow, so they include today and exclude future-dated transactions; past periods are whole calendar periods. Comparisons are calendar-aligned: a whole period compares with the previous month, quarter or year; a current period with the same span one period back, its day clamped to the end of a shorter month. A position compares with the position at the end of the previous period (for today, the end of last month). All time has no comparison.

## Book snapshot

Every report is computed from one snapshot of the Book (`server/src/services/snapshot.ts`), loaded by `snapshot-loader.ts`:

- One `bkper.getBook(id, true, true)` call, then one query per root group, all in parallel: `group:'<root>' before:<tomorrow> by:m` (the full monthly history; the last month is the month to date). Roots that report activity also get one query per partial-month comparison window (`comparisonWindows`), so current periods compare with the same days of an earlier month. Never query several roots at once: unbounded multi-group queries are slow and can fail.
- Amounts are decimal strings with the sign Bkper shows in its charts (bkper-js representative balances: negated for debit nature). Sum them with bkper-js `Amount`, never binary floats. A child's amount counts toward its group with the opposite sign when their `credit` natures differ (as in mixed groups).
- `periodAmount` and `positionAmount` answer only what the snapshot holds and return `undefined` otherwise; nothing is dated after the snapshot's `today`.
- Accounts appear once even when several roots contain them, so combine roots by account, not by summing root totals.
- Bkper leaves archived accounts whose balance is zero today out of balances, so the accounts of a group may not add up to the group's past amounts.
- KV caches a snapshot for 60 s per user and Book (`snapshot:v1:<userId>:<bookId>`). Identifying the user costs one `getUser` call per request. `Server-Timing` reports `user`, `kv` and `balances`; the per-request `ServerTiming` lives in `AppContext`.

`npx tsx scripts/verify-snapshot.ts [--today=YYYY-MM-DD] <bookId>...` checks snapshots of live Books, read-only, with your `bkper auth token`: cold and warm load times, the tree against `bkper group list`/`bkper account list`, and amounts against `bkper balance list --trial`. `--today` reads a Book as of an earlier day to exercise current periods on old data.

## Report calculation

`buildReport(intent, snapshot, live?)` (`server/src/services/report.ts`) turns an intent into report data: the answer (amount, previous, change), Incoming and Outgoing for a net result, the months of the period, the chart kind, the breakdown tree, type colors, the exact Bkper query and its URL. It is pure and deterministic.

- Roots that are permanent (Asset, Liability, or mixed of both) report a position at the period's `before`; all others, and the net result, report activity within the period.
- A calendar period that contains today (`2026`, `2026-Q4`, `2026-11`) reads to date as its current period (`this_year`, …), so no report includes future-dated transactions. Periods that have not started are rejected (`ReportError`, `future_period`).
- Rows are in the root's sense: a child whose credit nature differs from the root's counts negative (mixed groups), so every breakdown adds up to its parent. A remainder row (`kind: 'other'`) holds what Bkper left out of a group's children. Rows without amounts in any period or month are left out; rows are sorted by size, then the remainder, then rows without an amount in the period, which charts leave out. Shares are left out under mixed parents.
- The net result is Incoming minus Outgoing over the unique accounts of all activity roots; roots may share accounts, so root totals are never added. Outgoing is positive everywhere, as Bkper shows it: in the answer (`net`), in the breakdown's `incoming` and `outgoing` rows (each in its own sense, with its accounts) and in the chart, so a change has one value and sign everywhere. `net.months` holds the net result of each month, for the table's total row and the chart's line.
- Charts by the rules: the named view first; otherwise `monthly` means by month (bars for activity, a line for positions; a net result draws a bar series for each of Incoming and Outgoing that has an amount, and the net result as a line over them; no chart when every value of every month is zero, as charts leave out rows without amounts), else a breakdown chart over the rows with an amount: a donut for 2–6 positive rows of the root's type, ranked bars otherwise, none for fewer than two. `total` has no chart.
- The intent's `chart` (`REPORT_CHARTS`) is the person's preference; left out or `auto`, the rules choose, so older intents give the same reports. A preference that does not fit the report falls back quietly to the rules' chart, marked `fallback: true`:
  - `pie`: the rows with an amount, 2 or more, all positive and of the root's type (not under mixed groups or a net result).
  - `stacked`: a series per row by month, for 2+ months and 2+ rows with an amount, not for a net result (its sides are each in their own sense). At most `MAX_STACKED_SERIES` (6): the largest rows, and the rest (remainder rows, rows without an amount, smaller rows) as one `other` series (`OTHER_PART`), so the series add up to the root in every month.
  - `area`: the series of the chart by month, for 2+ months, when any of them has an amount in a month.
  - `compare`: the rows with an amount now or in the previous period, when there is one (not all time).
  - `waterfall`: a bridge whose `start` plus every step is exactly its `end` (checked; it throws otherwise). A net result goes from Incoming, minus each Outgoing account, to the net result; a permanent root from the previous position (at `previous.before`), plus each row's change, to the position. Other activity, or all time, does not fit. At most `MAX_WATERFALL_STEPS` (8), by size of the step, the rest as one `other` step.
  - `table`: no chart, always.
- Ratios (`change`, `share`) are decimal strings rounded to 4 places; format them, and amounts, only when rendering.

When the snapshot cannot answer, `buildReport` returns `{ liveQuery }` instead of `{ report }`: run that one query with `book.getBalancesReport`, normalize it with `readLiveBalances` (`live-balances.ts`), and call `buildReport` again with it.

- Hashtags always need `hashtagQuery(snapshot, hashtags)`: every root with the hashtags, by day, over the full history up to today. It depends only on the snapshot and the hashtags, so start it in parallel with intent resolution. Hashtag reports never read the snapshot.
- Periods the snapshot's months cannot answer (today's activity) need `rangeQuery`: the report's roots, by day, from the start of the previous period to the end of the current one.

`npx tsx scripts/verify-report.ts [--today=YYYY-MM-DD] [--hashtag=<tag>] <bookId>...` cross-checks reports of several intents per root (and the net result) against `bkper balance list`, read-only: answers, previous periods, every row and every month (for a net result: Incoming, Outgoing and Net, in the answer, the rows and each month), to the cent; that breakdowns add up and a net result is Incoming minus Outgoing; and that charts draw no row without an amount. It also asks every root for each chart preference and checks the chart data against the CLI: each stacked series in every month and their sum against the root, each compared row now and before, and every bridge's start, end and step, the rest (`other`) as what the CLI leaves after the parts shown, and that the steps add up to the end. Each line shows the preference, the chart drawn and whether it fell back. The CLI shows raw balances negated for permanent accounts (Liability and Outgoing negative), so it flips a CLI amount when its row's `credit` equals its `permanent`.

## Intent resolution

`resolveIntent(prompt, snapshot, { client, timing })` (`server/src/services/intent-resolver.ts`) turns a request in any language into a `ReportIntent` with ONE decision request to Jev, measured as `jev` in `Server-Timing`. It returns `{ recognized: true, intent, language? }` or `{ recognized: false, language? }` (not a report).

- `intent-questions.ts` holds every question, criterion and threshold (`THRESHOLDS`); review and tune them there, together. Jev only chooses among options code offers: the root groups (by name, described by their nature and up to 60 subgroup and account names) plus `net-result` and `none`; the period options of `buildPeriodOptions` within the snapshot's data range plus `unspecified`; whether to show months; the view; the chart the person names (`CHART_CRITERIA`: `pie`, `stacked`, `area`, `compare` with an earlier period, `waterfall`, `table` for no chart, or `unspecified`, with examples in several languages); the 133 Bkper languages (`report-shared/languages`). State is only `{ request, today }`.
- Code applies the thresholds: `none` or an unsure root is not a report; an unsure or unspecified period reads `defaultPeriod`, a trend when months, the trend view or a chart by month (`stacked`, `area`) are asked; an unsure view is left out; an unsure or unspecified chart is left out (`auto`, the rules' chart); the language is returned only when sure (≥ 0.8).
- Hashtags come from the request text (`extractHashtags`), never from Jev, so a caller can start `hashtagQuery` in parallel with Jev.
- `decision-client.ts` is the TypeSafe SDK connector: the platform outbound placeholder key in the Worker, a short timeout and one retry for typing, and `BkperAiError` keeping the Bkper AI error `code` (such as `usage_limit_exceeded`) for routes to map.

`BKPER_AI_TOKEN=<token> npx tsx scripts/eval-intent.ts [--only=<n>,...]` asks real Jev ~60 multilingual requests on the two test Books (snapshots read-only with your `bkper auth token`; Jev with `BKPER_AI_TOKEN` or the same token), chart requests among them, and reports accuracy per question, of the whole intent (chart included: a request that names no chart expects `auto`), and p50/p95 latency. Bkper AI caches identical requests for 15 minutes, so only a run after a change measures real latency. Tune the questions, never the expected answers.

## Report spec and catalog

`buildReportSpec(report, lang)` (`server/src/services/report-spec.ts`) turns report data into a json-render spec of the report catalog (`report-shared/catalog`), and validates it before returning it.

- The spec is the standard flat json-render spec (`root` plus an `elements` map of `{ type, props, children?, on? }`), built with `defineSchema`/`defineCatalog` from `@json-render/core`, pinned exactly, without React. Components: `Report` (the root, the only one with children), `Answer`, `Chart` (left out when the report has no chart), `BreakdownTable`, `Source`.
- `Chart` kinds, each with strict props: `bar`, `line` and `area` (months and series), `stacked` (months and 2+ series without `line`), `ranked-bar`, `donut` and `pie` (items of breakdown rows), `compare` (items with `value` and `previous`, and `periods`: the names of the period and the previous one, for a legend, both absolute and alike: calendar names such as `October 2026` and `September 2026`, the dates of a current period and the same span before, or the dates of two positions; never a relative name like `Last month`) and `waterfall` (`start`, floating `steps`, each with the `rowId` of its row unless it is the rest, and `end`). A bridge's start and end are labelled Incoming and the net result, or the dates of the two positions. Actions: `expandRow` (local, the renderer passes the row) and `openInBkper` (only where the renderer can navigate).
- `validateReportSpec` checks the catalog (components, actions, strict props of each element), json-render's `validateSpec` (including unreachable elements) and that the root is a `Report`. Renderers may call it on specs they receive.
- Every text is resolved in the spec, in the report's language: titles, period labels (`Intl` for years, months and dates, read as UTC calendar dates), comparisons, the labels of `other`, `incoming` and `outgoing` rows, and every label a renderer shows. Group and account names stay verbatim.
- Values written into a text (a period, a date, a name) are isolated with `isolate` (`report-shared/bidi`, FIRST STRONG ISOLATE … POP DIRECTIONAL ISOLATE), so dates and Latin names read in order in Arabic or Hebrew, and Arabic names in English. Where a text is read as words rather than shown, such as the request in `url`, `withoutIsolates` takes them out. Numbers in texts, like a quarter's, use the language's digits.
- A net result's BreakdownTable has a `total` row (the net result) under its Incoming and Outgoing rows, and its chart by month a series with `line: true` (the net result) over their bars.
- Amounts and ratios stay the report's decimal strings, and months and instants stay ISO; renderers format them with `Intl` in the Report's `locale`, with its `fractionDigits`, in its `dir`.

## API

`server/src/api/routes.ts` adapts HTTP; `server/src/services/report-service.ts` (`createReport`) and `suggestions.ts` (`buildSuggestions`) hold the behavior.

- `GET /api/v1/books/{bookId}/suggestions?language=` — up to 3 example requests (`SUGGESTION_COUNT`), each with its intent, chosen by fixed rules from the snapshot: the net result, the largest Outgoing root by month, the largest permanent root's position, then other roots. Roots without movements are left out, and periods anchor to the data (this year, or the last year with movements). It also warms the snapshot.
- `POST /api/v1/books/{bookId}/report` — body of exactly one of `prompt` (one Jev decision) or `intent` (no AI, with an optional `chart` preference), with optional `language` and `format`. `spec` (the default) returns `{ spec, intent, language, query, dataAt, chart, url }`, where `chart` is `{ kind, fallback }`: the chart drawn (`none` for none) and whether the intent's preference did not fit; `html` returns the report file (`text/html`, see Report file). Errors stay JSON. The plural `/reports` is kept free for saved or shared reports.
- Order of work: `getUser`, then the KV snapshot (its key needs the user, and Dispatch passes no identity), then Jev, whose options come from the snapshot. A prompt with `#hashtags` starts its live balances query before asking Jev, so both run in parallel. Jev answers in ~0.3 s when called often but ~1 s after some idle seconds; that, not the app, is most of the prompt path's p95.
- Language: the `language` field (any BCP 47 tag of a Bkper language, `supportedLanguage`), else the one Jev is sure of, else `Accept-Language`, else `en`.
- `url` opens the request in the Report app (`?book=&q=`), on the preview host when the API was called there, else production. `q` is the prompt, or the report's title and period for an intent.
- Errors use one envelope, `{ success: false, error: { code, message } }`, with the app's own messages, never the prompt or upstream details (`api/errors.ts`): 400 `invalid_request` (naming the field), 401 `unauthorized`, 403 `forbidden` (also for a Bkper 401, its answer to a user who is not a collaborator: the platform has already authenticated the caller), 404 `book_not_found`, 422 `not_a_report` (with `suggestions`), `future_period` and `unknown_root`, 429 `ai_allowance_exhausted` (Bkper AI `usage_limit_exceeded`), 502 `upstream_error` (Bkper or Bkper AI), 500 `internal_error`.
- `Server-Timing` on every API response: `user`, `kv`, `balances`, `jev`, `compute`, `render` and `total`.

`npx tsx scripts/measure-api.ts [--base=<url>] [--runs=<n>] [--cold=<n>] [--hashtag=<tag>] <bookId>...` times the suggestion-intent, prompt and hashtag paths of a running app (default the local Worker) from `Server-Timing`, warm and, with `--cold`, after the snapshot cache expires; read-only, with your `bkper auth token`. Prompts vary so Bkper AI's 15-minute cache of identical requests is not measured, but a rerun within 15 minutes repeats them.

## Docs for people and agents

`README.md` is the listing page people read (`bkper app get report` shows it too): what Report does, how to open it, examples in several languages, what it reads, and its limits. Keep development notes here, not there.

Agents decide from `bkper app list -b`, `bkper app get report` and `bkper app api spec report`, so the OpenAPI texts are written for them: the document's `info.description` (`server/src/api/openapi.ts`) is the guide, and each route, field and error repeats what an agent needs where it reads it (`routes.ts`, `schemas.ts`). The call they lead to: `POST /api/v1/books/{bookId}/report` with `{ "prompt": <the person's words, in their language>, "format": "html" }`, its output saved to an `.html` file the agent publishes. `bkper app api request` prints only an error's `message`, so messages say what to do next (`api/errors.ts`), never the request.

`npx tsx scripts/check-agent-docs.ts [--spec-url=<url>/openapi.json] [--model=<id>]` gives only the README, the listing and the OpenAPI document (this folder's, or a running app's) to a Bkper AI language model playing a fresh agent, asks it for the commands it would run for report requests in four languages, and checks them (`scripts/agent-docs/plan.ts`): the report call on the Book, the request in its own words, `format: html`, the file saved and published, nothing that changes the Book. Nothing runs and no Book is read. Rerun it after changing the README, the listing's `description` or the OpenAPI texts.

## Report renderer

`<report-view>` (`client/src/report/`, entry `index.ts`) renders a report spec with Lit and Web Awesome Pro: answer first, then the chart, the breakdown table and the source, in the spec's order, `locale` and `dir`. Set its `spec` property.

- Self-contained: no app state, no network, and only type imports from `report-shared/catalog` (its validation code is large; the server validates every spec), plus the tiny `report-shared/bidi`. It registers the Web Awesome charts and sparkline it uses; the page provides the Web Awesome theme and `@bkper/web-design` tokens. So the web app and a standalone report file can bundle it alone.
- `format.ts` formats the spec's decimal strings exactly with `Intl` (never through floats); `ReportFormat.plot` gives the numbers charts draw. Charts' tooltips show the exact amounts, name and amount each isolated. A share never shows as a signed zero: a share too small to show, other than zero, reads `<0.1%` in the locale's digits.
- `chart-config.ts` builds the Chart.js configuration of every chart kind, for `wa-bar-chart`, `wa-line-chart`, `wa-doughnut-chart` and `wa-pie-chart`. Colors are the Bkper type color tokens (`--bkper-color-<color>-<low|medium|high>`, the palette of Bkper's charts), so they follow the light or dark theme; a donut, a pie and stacked parts shade items of one color from high to low (`shades`). Ranked bars of negative values go the other way from zero, in their type's color, with room past zero (`grace`) and a minimum length, so a tiny value, such as a small overdraft, still shows.
  - By month: `bar` (bars), `line` (a line), `area` (each series filled from zero, the net result's `line` series a line over them, on an axis from zero) and `stacked` (stacked bars, a shade per part, a line of the surface between parts). Lines and areas keep half a month from the chart's edges (`offset`), so the first and last months' labels show whole in either direction.
  - `compare`: horizontal bars in pairs, the previous period first, outlined (a light fill and a border), and this period solid, so they differ in more than color; the legend names both periods. A zero draws no bar.
  - `waterfall`: floating horizontal bars in `wa-bar-chart` (Chart.js `[start, end]` data, positions in display floats only; the exact amounts are in the tooltips). The start and end stand on zero, solid in the strong tone; a step up is solid, a step down outlined. A small Chart.js plugin of the config (`barLabelsPlugin`) writes each bar's value (`barLabels`) past its end, steps with their sign (`signedCompact`), in the ticks' font and color, and past its other end when it does not fit in the chart, so labels never cover the names.
  - `chartSwatches` gives the colors of the rows a chart draws as items or series of their own (ranked bars, donuts, pies, comparisons and stacked parts), the table's swatches.
- Values the renderer places next to texts (amounts, changes) are isolated with CSS (`unicode-bidi: isolate`) and inherit the report's direction; texts of the spec carry their own isolates.
- The breakdown is a plain table with disclosure buttons, not `wa-data-grid`: the grid would more than double the renderer's size (about 600 KB minified) and it would hide the row hover the chart follows. `wa-icon` fetches its SVGs, which a strict content security policy blocks, so the chevron is inline SVG.
- Rows open in place when the spec binds `expandRow`. Hovering or focusing a row, or else the row opened last, highlights it in the chart: its top-level item in a breakdown chart or a comparison, its series in a net result, the part it is in when parts are stacked, its steps in a bridge (a row that holds steps, such as Outgoing, also highlights the rest of them), or its months added to another chart by month; the rest fades. A row the chart does not draw (no amount in the period) highlights nothing. The table's swatches are the legend of the rows the chart draws.
- A series with `line` is drawn as a line over the bars of `wa-bar-chart` (Chart.js mixed datasets, no extra component). The table's `total` is a `tfoot` row.
- Events (`events.ts`), bubbling and composed: `report-expand-row` (`{ rowId, expanded }`) and `report-open-in-bkper` (`{ url }`, cancelable: cancel it to navigate another way). The link to Bkper shows only when the spec binds `openInBkper`; a host that cannot navigate sets `link` (`{ url, label }`) instead, a plain link in the Source.

`http://localhost:5207/dev/report.html` is a development-only gallery of recorded specs (`?only=<id>,…`, `?width=<css length>`; the `bkper_theme` cookie picks light or dark). `npx tsx scripts/generate-report-specs.ts` rebuilds those specs (`client/dev/specs/*.json`, which the renderer tests read) with the real report and spec builders from made-up Books shaped like recorded payloads: `scripts/fixtures/studio-book.ts`, a balanced design studio, and the server test Book. Rerun it when the report data or the spec changes. With Book ids it reads live Books, read-only, into `client/dev/specs/local/`, which Git ignores so real Book data is never committed.

## Report file

`format: "html"` returns one self-contained HTML file of the report, for the Bkper Agent, which shows a published HTML file in an `<iframe sandbox="allow-scripts">` whose `srcdoc` starts with its Content-Security-Policy (`default-src 'none'`, inline scripts and styles only; bkper-clients `packages/agent/client/src/file-views.ts`). So the file loads nothing: no network, fonts or icons.

- `npm run build:report-file` (`client/vite.report-file.config.ts`) bundles `client/src/report-file/` alone, the renderer with the Web Awesome theme and `@bkper/web-design` tokens, into one classic script and one stylesheet, written as `server/src/generated/report-file-bundle.ts` (Git and Prettier ignore it). The build fails if either holds text that would end its inline element. `postinstall`, `dev`, `build` and `check:generate` run it before anything imports the server; rerun it after changing the renderer while `npm run dev` runs.
- `buildReportFile(spec, link)` (`server/src/services/report-file.ts`) writes the document around that bundle, held in the Worker's memory: `lang` and `dir`, `<meta charset>`, the same policy, a `<title>` of the report's title and period, and the data (`ReportFileData`, `report-shared/report-file`) as a JSON script with `<`, U+2028 and U+2029 escaped. Nothing is bundled per request; `render` in `Server-Timing` includes it.
- The file cannot open Bkper in place, so the Source drops `openInBkper` and links to the same report in the Report app (the response's `url`, `source_open_in_report`). The file follows the viewer's light or dark color scheme (`prefers-color-scheme`); rows open in place and charts show tooltips offline.
- The bundle is ~345 KB and stays under 400 KB (a test); the Agent shows HTML files up to 1 MB, so report data has the rest.

`npx tsx scripts/verify-report-file.ts [--screenshots=<dir>] [<file.html>...]` opens report files in headless Chromium exactly as the Agent frames them, with every request blocked, and fails on any request, policy violation or console error, or when the answer, the chart, its tooltip, the link or opening a row do not work, or when a value isolated in a text (and the ends of an isolated date range) does not read in the report's direction, measured on screen; in light and dark. Without files it writes one per recorded spec; files saved from the local Worker end with the live-reload script `bkper app dev` adds to HTML, which it leaves out. It needs Playwright's headless shell: `npx playwright-core install chromium-headless-shell`.

## Web client

Without a Book in the URL, the app shows the Book picker (`components/book-picker.ts`): the person's Books changed most recently (`lastUpdateMs`, sorted by the `Books` store), at most `RECENT_BOOKS` (8), and, when they have more, a field that finds any of them by every word typed, ignoring case and accents (`findBooks`); Enter opens the first. Its texts, the loading state and the errors of the `Books` store (string keys) come from the strings, in the interface's language and direction; Book names keep their own direction.

The Book page (`components/report-page/`) is one input, with no submit button, and the report below it. Its behavior lives in the `Reports` store (`state/reports.ts`), the input controller, which the unit tests cover:

- A request goes out `DEBOUNCE_MS` (250 ms) after the last keystroke once it has `MIN_WORDS` (2) words, counted with `Intl.Segmenter` so languages written without spaces count too; Enter asks at once. A newer request aborts the one in flight (`AbortController`), and an answer to any but the latest request is dropped (a sequence id).
- The last report stays on screen while the next is on its way, with a thin progress line under the input that appears only when the wait is felt; the page changes into the next report with a view transition scoped to the report (`Element.startViewTransition`), over the whole page where only document transitions exist, and without one otherwise or under reduced motion.
- Reports are remembered in memory per Book, by normalized request and by intent (with its language and chart; no chart is `auto`); failures are forgotten. When the suggestions arrive, their reports are fetched by intent (no AI) and remembered under their texts too, so choosing or typing a suggestion shows it from memory.
- The suggestions show under the empty input, in the style of the Bkper Agent home, and with the notices they answer: `not_a_report` (a quiet hint; the last report stays) and `ai_allowance_exhausted`. Other failures show a short message from `shared/catalog/en.json`, never the error.
- `route.ts` alone keeps the request in the URL (`q`), replacing the entry as the person types; opening a URL with `q` runs it at once. Another Book drops it.
- `AppState` opens the reports of the Book in the URL once signed in, and preloads the report renderer (`report-loader.ts`, a code-split chunk with the charts) as the app connects, so the shell and the input show first. The interface language is the browser's when Bkper has it, else English; suggestions and the reports they ask for use it, while a typed request gets the language the server detects.

## Strings

`shared/catalog/en.json` holds every UI and report string: key → `{ text, role, context, placeholders? }`. Placeholders are named, `{name}`, and each is documented in `placeholders`; a test enforces both. Write `context` for a translator who sees nothing else: where the string appears, what it means in Bkper, and how short it must be.

`t(key, lang, params)` (`report-shared/strings`) reads a language added with `addLocale(lang, messages)` (a flat `key → text` map), then its base language (`pt-BR` → `pt`), then English; blank texts fall back too. Params fill placeholders verbatim, so format numbers and dates before passing them; a placeholder without a value stays visible. `textDirection(lang)` gives `rtl` for right-to-left languages (a test checks it against each language's script).

`shared/locales/{lang}.json` holds the strings of each of the 133 Bkper languages, generated and committed; never edit `en.json`, which is the catalog's English. How they load:

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
| A report of a Book | `POST /api/v1/books/{bookId}/report` |
| OpenAPI contract | `GET /openapi.json` |
| Static client | Worker fallback backed by the `ASSETS` binding |
| Platform storage | `KV` service binding |
| Book menu | `bkper.yaml` `menuUrl`: `https://report.bkper.app/?book=${book.id}` |

## Current implementation structure

```text
client/src/
├── index.ts       — Browser entrypoint
├── web-awesome.ts — Web Awesome Pro component registration for the client UI
├── components/    — Lit features with co-located view and CSS: the app shell, the Book picker, the Book page, the suggestions
├── state/         — Stores: the URL (route), Books, the input controller (reports), and their wiring (app-state)
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
    └── report-file.ts — The data a report file carries for its script
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
| Change API error mapping   | `server/src/api/errors.ts`                              |
| Change periods or dates    | `server/src/services/periods.ts`                        |
| Change the report intent   | `server/src/services/report-intent.ts`                  |
| Change the Book snapshot   | `server/src/services/snapshot.ts`, `snapshot-loader.ts` |
| Change report calculation  | `server/src/services/report.ts`                         |
| Change intent questions or thresholds | `server/src/services/intent-questions.ts`    |
| Change how answers become an intent | `server/src/services/intent-resolver.ts`       |
| Change live balance queries | `server/src/services/live-balances.ts`                 |
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
