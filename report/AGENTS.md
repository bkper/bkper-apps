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

- **Client**: Lit + Web Awesome Pro; a Book picker and the selected Book, with the Book in the URL as `?book=<bookId>`.
- **Server**: Hono Worker serving typed OpenAPI `/api/v1/*` routes. No `/events`: the app only reads Books and never changes them.

## Accounting rules

- Numbers come only from deterministic code over Bkper balances. AI may choose among options the code offers; it never computes amounts or dates, and never writes queries.
- Read-only on Books: never create, update or delete anything in a Book, and do not subscribe to events.
- Periods resolve to ISO dates in the Book time zone: `after:` inclusive, `before:` exclusive. Only "today" reads the clock; positions (Asset, Liability) default to today, activity (Incoming, Outgoing) to this year. Current periods (this month, quarter and year, year to date, the last 12 months, all time) end at tomorrow, so they include today and exclude future-dated transactions; past periods are whole calendar periods. Comparisons are calendar-aligned: a whole period compares with the previous month, quarter or year; a current period with the same span one period back, its day clamped to the end of a shorter month. A position compares with the position at the end of the previous period (for today, the end of last month). All time has no comparison.

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
- Rows are in the root's sense: a child whose credit nature differs from the root's counts negative (mixed groups), so every breakdown adds up to its parent. A remainder row (`kind: 'other'`) holds what Bkper left out of a group's children. Rows without amounts are left out; rows are sorted by size. Shares are left out under mixed parents.
- The net result is Incoming minus Outgoing over the unique accounts of all activity roots; roots may share accounts, so root totals are never added.
- Charts: the named view first; otherwise `monthly` means by month (bars for activity, a line for positions), else a breakdown chart: a donut for 2–6 positive rows of the root's type, ranked bars otherwise. `total` has no chart.
- Ratios (`change`, `share`) are decimal strings rounded to 4 places; format them, and amounts, only when rendering.

When the snapshot cannot answer, `buildReport` returns `{ liveQuery }` instead of `{ report }`: run that one query with `book.getBalancesReport`, normalize it with `readLiveBalances` (`live-balances.ts`), and call `buildReport` again with it.

- Hashtags always need `hashtagQuery(snapshot, hashtags)`: every root with the hashtags, by day, over the full history up to today. It depends only on the snapshot and the hashtags, so start it in parallel with intent resolution. Hashtag reports never read the snapshot.
- Periods the snapshot's months cannot answer (today's activity) need `rangeQuery`: the report's roots, by day, from the start of the previous period to the end of the current one.

`npx tsx scripts/verify-report.ts [--today=YYYY-MM-DD] [--hashtag=<tag>] <bookId>...` cross-checks reports of several intents per root (and the net result) against `bkper balance list`, read-only: answers, previous periods, every row and every month, to the cent, and that breakdowns add up. The CLI shows raw balances negated for permanent accounts (Liability and Outgoing negative), so it flips a CLI amount when its row's `credit` equals its `permanent`.

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
| OpenAPI contract | `GET /openapi.json` |
| Static client | Worker fallback backed by the `ASSETS` binding |
| Platform storage | `KV` service binding |
| Book menu | `bkper.yaml` `menuUrl`: `https://report.bkper.app/?book=${book.id}` |

## Current implementation structure

```text
client/src/
├── index.ts       — Browser entrypoint
├── web-awesome.ts — Web Awesome Pro component registration for the client UI
├── components/    — Lit features with co-located view and CSS
├── state/         — Stores: the URL (route), Books, and their wiring (app-state)
├── auth/          — @bkper/web-auth session boundary
├── services/      — bkper-js orchestration for the browser
└── api/           — Typed /api/v1 client and generated OpenAPI types
client/dev/        — Development-only pages served by vite dev

server/src/
├── index.ts      — Worker composition, middleware, health, static assets
├── api/          — HTTP API routes, OpenAPI schemas, API error responses
└── services/     — App behavior and Bkper SDK orchestration
```

## Key files

| Task                       | File                                                    |
| -------------------------- | ------------------------------------------------------- |
| Add UI rendering           | `client/src/components/report-app/report-app-view.ts`   |
| Add shared client state    | `client/src/state/`                                     |
| Change what the URL holds  | `client/src/state/route.ts`                             |
| Add Bkper client behavior  | `client/src/services/book-service.ts`                   |
| Add typed client API calls | `client/src/api/app-api.ts`                             |
| Configure client dev/build | `client/vite.config.ts`                                 |
| Add API schemas            | `server/src/api/schemas.ts`                             |
| Add API endpoints          | `server/src/api/routes.ts`                              |
| Add server behavior        | `server/src/services/`                                  |
| Change periods or dates    | `server/src/services/periods.ts`                        |
| Change the report intent   | `server/src/services/report-intent.ts`                  |
| Change the Book snapshot   | `server/src/services/snapshot.ts`, `snapshot-loader.ts` |
| Change report calculation  | `server/src/services/report.ts`                         |
| Change live balance queries | `server/src/services/live-balances.ts`                 |
| Add a Server-Timing metric | `server/src/services/timing.ts`                         |
| Regenerate API types       | `npm run api`                                           |
| Configure app              | `bkper.yaml`                                            |
<!-- APP_SPECIFICS:END -->
