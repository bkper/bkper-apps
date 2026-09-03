# Inventory Bot: GCP and Apps Script to Cloudflare Migration Roadmap

## Status

**Chunk 5 complete — posting prevention, unchecking, deletion, and linked cleanup are ported with deterministic lifecycle safeguards.**

The current Google Cloud Function remains production-authoritative for events, and the current Google Apps Script web app remains production-authoritative for the Inventory Bot menu. The clean target under `new/` now routes all four subscribed events through request-isolated Platform SDK contexts, preserves the accepted common resolution behavior, reproduces the checked-transaction path that creates complete quantity movements in the Inventory Book, and preserves the source lifecycle selection, rebuild, and cleanup behavior. Chunk 6 is next: complete the event parity and drift audit before beginning menu accounting work.

## Purpose of this document

Inventory Bot will follow the full-stack migration process established by Portfolio Bot: capture the production baseline, migrate events and the menu into one Bkper Platform application, validate the Cloudflare target in parallel, cut over the webhook and menu independently, stabilize both surfaces, and consolidate the accepted target at the project root.

This roadmap describes migration objectives, implementation chunks, dependencies, verification gates, rollout controls, and completion criteria. Implementation-specific legacy discrepancies will be characterized when their behavior area is reached; they do not need to be resolved in advance to define the migration.

This is a public, community-facing roadmap. It records technical decisions and reproducible outcomes without retaining raw operational logs, Book or resource identifiers, internal infrastructure identifiers, personal names, secret values, or routine approval chronology.

## Objective

Migrate the published `inventory-bot` app from:

- a Google Cloud Function that handles Bkper events; and
- a Google Apps Script web app that provides the Inventory Bot menu and its server operations;

into one Bkper Platform application whose Cloudflare Worker serves:

- the bundled browser client;
- authenticated, versioned `/api/v1/*` routes used by that client and available as a public app API;
- Bkper event ingress at `/events`;
- the generated OpenAPI contract at `/openapi.json`.

The event handler targets maximum practical code and behavior parity. The GAS menu does not: moving from server-rendered GAS, synchronous `bkper-gs`, and `google.script.run` to Lit, Hono, and asynchronous `bkper-js` necessarily changes the architecture, API boundary, and UI implementation.

The menu migration preserves accepted accounting outcomes and essential workflows while delivering a production-quality target client. It does not claim source-code or pixel-level UI parity.

## Non-negotiable invariants

1. **Protect Bkper's zero-sum invariant above all else.** Every posted Transaction created or changed by Inventory Bot remains one complete movement with one amount from an origin Account to a destination Account.
2. **Protect each Book independently.** Quantity movements in the Inventory Book and monetary movements in each Financial Book balance within their own Book.
3. **Preserve resource meaning.** Purchases, sales, quantity-bearing credit notes, COGS, additional costs, credit amounts, FIFO splits, and Reset behavior retain their accepted movement meaning.
4. **Incomplete or unresolved behavior remains non-balance-affecting.** Missing resources, unsupported inputs, and zero or absent quantities must not create unintended posted movements.
5. **Preserve relationships and idempotency.** Remote ids, parent ids, split relationships, purchase and liquidation logs, and linked lifecycle behavior must not create duplicate active movements.
6. **Preserve FIFO determinism.** Date, explicit order, creation order, checked state, complete lots, partial lots, credit-note quantities, and cost adjustments retain their accepted precedence and effects.
7. **The legacy implementations remain authoritative until their respective cutovers.** Production patches during migration must be characterized and ported.
8. **Do not mix migration with silent business-logic fixes.** Record inherited issues and resolve them separately unless a target-runtime, security, or explicitly accepted workflow requirement forces a documented deviation.
9. **The rendered eligible Account list is the operation scope.** Calculate and Reset operate on the same visible Account list for selected-Account, selected-Group, and whole-Book contexts.
10. **Tests never write to live Books.** Deterministic tests intercept SDK, network, API, browser, clock, and UUID boundaries.
11. **Deployment and routing remain separate.** A deployed Worker does not imply that production events or the menu route to it.
12. **Webhook and menu cutovers remain independent.** Each has its own validation, stabilization, and rollback decision.
13. **Remote mutations require explicit approval.** App sync, deploy, installation, event replay, routing changes, canaries, and Book writes are reviewed separately immediately before execution.
14. **Do not claim full parity.** Completion means accepted domain behavior coverage, documented target differences, and successful rollout evidence.

## Authoritative legacy surfaces

### GCP event handler

The current `legacy/events/` project is the source candidate for the production-authoritative event implementation. Its relationship to the active deployed artifact must be established in the baseline chunk.

It handles four subscribed event types:

- `TRANSACTION_CHECKED`;
- `TRANSACTION_UNCHECKED`;
- `TRANSACTION_POSTED`;
- `TRANSACTION_DELETED`.

Its responsibilities include:

- Inventory and Financial Book resolution;
- purchase, sale, and quantity-bearing credit-note recognition;
- quantity mirroring into the Inventory Book;
- `Buy`, `Sell`, item Account, and direct Group creation where established;
- remote-id duplicate prevention;
- rebuild flags for historical or manually changed inventory activity;
- prevention of direct posted activity in the Inventory Book;
- linked deletion across Inventory and Financial Books;
- split cleanup and COGS cleanup;
- event responses and loop prevention.

### Google Apps Script web app

The current `legacy/menu/` project is the source candidate for the production-authoritative menu behavior and accounting operations. Its relationship to the active GAS deployment and compiled assets must be established in the baseline chunk.

It handles:

- originating Book, selected Account, and selected Group context;
- Inventory Book and Financial Book resolution;
- eligible Inventory Account selection;
- pending-task validation;
- FIFO COGS calculation;
- complete and partial purchase lots;
- quantity-bearing credit notes;
- additional costs and credit amounts;
- purchase and liquidation logs;
- generated COGS movements in Financial Books;
- checked-state transitions and Account calculation state;
- Reset of generated COGS and FIFO state;
- per-Account summaries.

The accepted source and deployed artifacts, not README interpretations or the earlier `new/` attempt, define the migration baseline.

## Domain behavior preserved

Inventory Bot coordinates one Inventory Book and one or more Financial Books in the same Collection.

- Financial Books hold monetary purchase, sale, credit, and COGS movements.
- The Inventory Book holds quantity movements for goods.
- Checked eligible purchases create quantity movements from `Buy` to the item Account.
- Checked eligible sales create quantity movements from the item Account to `Sell`.
- Quantity-bearing credit notes create the established reverse quantity movement involving the item and `Buy` Accounts.
- Additional costs and credit amounts without an eligible quantity remain Financial Book inputs to COGS rather than creating unintended quantity movements.
- Mirrored Transactions retain accepted dates, quantities, descriptions, properties, Accounts, remote ids, and response behavior.
- Purchase-time item Account and direct Group creation retain accepted fields, eligibility, and lookup behavior.
- Duplicate event delivery does not create a duplicate active quantity movement.
- FIFO consumes eligible unchecked purchases and sales in the accepted order.
- Complete lots, partial lots, purchase splits, parent relationships, purchase logs, liquidation logs, total costs, and checked state retain accepted semantics.
- COGS remains a monetary movement from the Financial Book item Account to the outgoing `Cost of goods sold` Account.
- COGS Transactions retain accepted date, amount, description, quantity, sale reference, checked state, and remote-id relationship.
- Calculate retains its rebuild dependency: when an Account requires rebuilding, established Reset behavior runs instead of continuing with stale FIFO state.
- Reset removes linked generated COGS, removes split Transactions, restores parent quantities and cost properties, clears calculation properties, restores checked state as established, and clears Account calculation and rebuild state.
- Direct posting in the Inventory Book, manual unchecking, and linked deletions retain their accepted warning, cleanup, and rebuild behavior.
- Unsupported update or lifecycle behavior is not silently invented during migration.

## Migration fidelity rules

### Event-side rules

- Preserve source class, function, method, and parameter names where practical.
- Preserve class decomposition, branch order, lookup order, mutation order, return normalization, logging, concurrency, and side effects.
- Do not refactor, modernize, optimize, or clean up event business behavior during the parity port.
- Limit mechanical changes to runtime boundaries, module syntax, strict TypeScript, request-scoped Platform authentication, SDK compatibility, and build packaging.
- Compare GCP and target implementations side by side before completing each event chunk.
- Characterize runtime-sensitive unawaited legacy operations and ensure required Cloudflare work completes before the request ends.
- Record every retained deviation.
- Stop and escalate any adaptation that can change movement direction, amount, state, linked cleanup, idempotency, or the zero-sum invariant.

### Menu, API, and client rules

- Preserve accounting outcomes, selected resources, operation ordering, and essential workflows—not GAS source structure.
- Treat `/api/v1/*` as a new reusable public API, not a `google.script.run` compatibility transport.
- Keep API routes thin and move accounting behavior into server services.
- Use explicit schemas, authorization, structured errors, OpenAPI, and generated client types.
- Keep parity accounting services free of HTTP response construction.
- Port parity behavior and wire it into API facades in separate reviewable steps.
- Replace synchronous `bkper-gs` with asynchronous `bkper-js` deliberately, preserving mutation order where accounting behavior depends on it.
- Expose Calculate and Reset as Account-level operations because the legacy server already processes one Account at a time.
- Execute the visible Account list sequentially.
- Continue to later Accounts after an individual Account failure, but never retry a mutation automatically. Mark uncertain outcomes explicitly.
- Abort before the Account sequence for global context, authentication, authorization, installation, or pending-task failures.
- Use the same rendered Account scope for Calculate and Reset. This is an explicitly accepted workflow correction, not a silent parity claim.
- Reset does not require an additional confirmation dialog.
- Do not preserve GAS UI structure or styling for its own sake.
- Use the Bkper design foundation and deliver a responsive, accessible, theme-aware client.
- Allow client UX improvements when they do not silently change selected Accounts, operation intent, mutation requests, or accounting outcomes.
- Document material API, runtime, workflow, and UI differences instead of labeling them as parity.

## Architecture

### Baseline layout before Chunk 1

```text
inventory-bot/
├── legacy/
│   ├── events/       # production GCP event source candidate
│   ├── menu/         # production GAS menu source candidate
│   ├── bkper.yaml
│   ├── package.json
│   ├── README.md
│   └── LICENSE
├── new/              # abandoned earlier migration attempt; non-authoritative
└── ROADMAP.md
```

### Layout after Chunk 1

```text
inventory-bot/
├── legacy/
│   ├── events/       # preserved event source candidate
│   ├── menu/         # preserved menu source candidate
│   ├── bkper.yaml
│   └── package.json
├── ROADMAP.md
├── README.md
└── LICENSE
```

No target directory remains after baseline capture. Chunk 2 creates a clean `new/` application without inheriting files, dependencies, configuration, or guidance from the abandoned attempt.

### Temporary migration layout

The earlier target is removed and a clean target is created only after the production baseline is captured:

```text
inventory-bot/
├── legacy/
│   ├── events/       # production-authoritative event implementation
│   ├── menu/         # production-authoritative menu implementation
│   ├── bkper.yaml
│   └── package.json
├── new/
│   ├── client/       # Vite + Lit browser client
│   ├── server/       # Hono Worker: /api/v1/*, /events, OpenAPI, assets
│   ├── bkper.yaml
│   ├── package.json
│   └── tsconfig.json
├── ROADMAP.md
├── README.md
└── LICENSE
```

Production `menuUrl` and `webhookUrl` remain on GAS and GCP while development URLs can move independently to Cloudflare preview. Only the clean target project is used for Platform build and deployment operations.

### Intended final layout

```text
inventory-bot/
├── AGENTS.md
├── ROADMAP.md
├── README.md
├── LICENSE
├── bkper.yaml
├── bun.lock
├── env.d.ts
├── package.json
├── tsconfig.json
├── client/
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/
│   └── test/
└── server/
    ├── package.json
    ├── tsconfig.json
    ├── src/
    └── test/
```

The previous GCP and GAS source remains recoverable from Git history. Their unchanged deployed runtimes remain independent routing rollback targets until separately retired.

## Cloudflare target decisions

- One full-stack Worker serves static client assets, authenticated `/api/v1/*`, `/events`, and `/openapi.json`.
- The Worker exposes no standalone scaffold health endpoint.
- The client uses Lit, Vite, Web Awesome, `@bkper/web-design`, and `@bkper/web-auth`.
- The client uses authenticated browser-side `bkper-js` for generic read-only Bkper context and UI behavior.
- Calculate and Reset mutations run through authenticated Account-level server API routes.
- The public API initially exposes only the two active Inventory Bot operations and context strictly required by those operations.
- The exact initial route contract is established in the typed API chunk, with the expected resource shape:
  - `POST /api/v1/books/{bookId}/accounts/{accountId}/calculate`;
  - `POST /api/v1/books/{bookId}/accounts/{accountId}/reset`.
- Successful mutation requests use one shared `200 OK` `{ message: string }` response unless contract work establishes a concrete consumer requirement for another representation.
- The message carries operation commentary, not a mutation receipt. Bkper remains the authoritative resource and audit source.
- API authorization and installation checks are explicit and do not rely on hidden client controls.
- Each mutating request resolves the Inventory Book, item Account, and corresponding Financial Book before its first write.
- Each mutating request requires explicit `EDITOR` or `OWNER` permission and Inventory Bot installation on every Book it may mutate.
- Client context validates availability across the complete visible operation scope before the sequence begins; each Account-level server route repeats its own authoritative checks.
- Bkper Core remains authoritative for every request after application preflight.
- Server routes and event handlers create request-scoped `Bkper` instances without OAuth, API-key, or agent-id providers.
- Worker code never reads or forwards `Authorization`, `bkper-oauth-token`, or `bkper-agent-id`.
- Event-side and menu-side business behavior remain separate during migration.
- No KV or secret is introduced unless implementation evidence establishes a requirement.
- Strict TypeScript, Bun, exact dependency pins, a committed lockfile, deterministic tests, production builds, formatting, and generated-contract checks form the local gate.
- Local ports remain Vite `5175` and Worker `8796`.
- Embedded client context changes use Bkper's trusted app URL-change boundary and cannot leave stale actionable Account or Group scope.

## Implementation-time decisions

The roadmap deliberately defers code-level decisions until their evidence is available.

### SDK and tooling versions

The baseline must establish the exact deployed GCP dependency graph, GAS library version, compiled artifacts, and build settings before selecting target pins.

The compatibility audit covers:

- missing-resource behavior and optional `404` lookups;
- complete-chart Account and Group caching;
- Amount parsing, arithmetic, comparison, zero handling, and rounding;
- Book timezone, fraction digits, locks, and closing behavior;
- transaction pagination, ordering, and first-match semantics;
- batch create, update, trash, and checked-state serialization;
- remote ids, parent ids, properties, and linked queries;
- request retries, structured errors, and Platform authentication;
- asynchronous completion requirements in the Worker request lifecycle.

Exact Bkper CLI, `bkper-js`, TypeScript, Miniflare, browser, and supporting versions are pinned only after compatibility checks.

### API contract details

The typed API chunk establishes:

- exact Calculate request data, including how the established calculation date is represented;
- path and request validation;
- shared success and error schemas;
- permission and installation failure behavior;
- operation commentary;
- OpenAPI generation and generated client types.

The API must not expose GAS transport details, bulk cross-Account mutation requests, automatic mutation retries, or unverified resource receipts.

### Legacy discrepancies and inherited behavior

Implementation-specific differences discovered during baseline and parity work are recorded in a small ledger and classified as:

- production-authoritative behavior to preserve;
- source-versus-deployment drift;
- accepted target-runtime adaptation;
- explicitly approved workflow or security deviation;
- inherited issue deferred until after migration.

Discovery alone does not authorize a behavior change.

## Deterministic verification strategy

### Test boundary

Tests execute target production handlers, API routes, services, SDK models, client controllers, and components while intercepting SDK, network, API, browser, clock, delay, and UUID boundaries.

They require no credentials, deployment, external request, or live Book access.

Each behavior chunk follows this workflow:

1. Add the smallest target production stub required by the behavior.
2. Add the smallest failing test describing the accepted legacy outcome or target contract.
3. Implement only enough target behavior to pass.
4. Run focused tests.
5. Run the complete deterministic gate.
6. Compare event code with GCP or menu accounting outcomes with GAS as applicable.
7. Record accepted differences and keep the tests as target safeguards.

### Event behavior matrix

#### Ingress and common resolution

- All four subscriptions and the unknown-event path retain accepted routing and responses.
- Every request receives isolated SDK context and Platform authentication.
- Inventory and Financial Book discovery retain accepted ordering, properties, aliases, and fallbacks unless an explicit deviation is approved.
- Currency, Account, Group, quantity, and transaction recognition rules retain accepted behavior.
- Inventory Bot agent activity does not create event loops.

#### Checked quantity movements

- Purchase, sale, and quantity-bearing credit-note recognition retain established property and Account requirements.
- Mirrored quantity Transactions retain amount, direction, date, description, properties, Accounts, and remote ids.
- `Buy`, `Sell`, item Account, and direct Group creation retain accepted behavior.
- Existing mirrors, missing quantities, zero quantities, unsupported inputs, mismatched Financial Books, and missing resources retain accepted behavior.
- Rebuild flags retain accepted date and Account rules.
- Every posted quantity movement is complete; unresolved behavior remains non-balance-affecting.

#### Posting, unchecking, and deletion

- Direct posting in the Inventory Book retains accepted cleanup and warning behavior.
- Manual Inventory Book unchecking retains accepted rebuild behavior and loop prevention.
- Financial purchase, sale, additional-cost, credit-note, and COGS deletion paths retain accepted matching and rebuild behavior.
- Inventory Book purchase, sale, split, and linked COGS deletion paths retain accepted cleanup and state transitions.
- Linked cleanup retains accepted lookup, uncheck, trash, response, and failure order.
- Deletion creates no replacement or incomplete movement.

### Menu behavior matrix

#### Context, scope, and validation

- Originating Book, Account, and Group context resolve to the accepted Inventory Book and eligible item Accounts.
- Account context takes precedence over Group context.
- Selected Account, selected Group, and no-selection scope produce one deterministic, alphabetically ordered visible Account list.
- The same visible Account list drives Calculate and Reset.
- Missing context, unsupported resources, pending tasks, permissions, installation, locks, and closing conditions produce explicit target states.
- Every mutating request resolves and preflights the Inventory and Financial Books it may change before its first write.
- Unauthorized or uninstalled operations fail before any Account or Transaction mutation begins.

#### Reset

- Reset retains linked COGS cleanup, checked-state handling, split cleanup, parent quantity and property restoration, credit-note state, Account dates, and rebuild-state cleanup.
- Processor phases retain accepted order across Financial and Inventory Books.
- Locked or unresolved paths do not produce an unintended posted movement.
- Reset operates only on the Account named by its Account-level request; the client sequence defines the visible multi-Account scope.

#### Calculate

- Calculate retains its Reset-and-return dependency when rebuild is required.
- FIFO sorting, complete and partial lots, credit-note quantity handling, purchase splits, parent relationships, purchase logs, liquidation logs, and checked state retain accepted outcomes.
- Additional-cost and credit-amount lookup, date range, precedence, and cost allocation retain accepted behavior.
- Total cost and per-unit cost arithmetic retain accepted precision and rounding.
- COGS Account lookup and creation retain accepted type and naming behavior.
- Generated COGS retains amount, direction, Accounts, properties, description, checked state, and remote-id linkage.
- Ordered Inventory create, Inventory update, and Financial create phases remain deterministic.
- Locked or unresolved paths do not create an unintended posted movement.

### Client behavior matrix

- The app shell or a meaningful loading state renders before authentication and data loading finish.
- Authentication and login-required behavior use `@bkper/web-auth`.
- URL context produces the accepted Book, Account, Group, and visible Account scope.
- Trusted embedded Bkper URL changes refresh context; malformed, stale, cross-origin, or wrong-source messages are ignored.
- Calculate and Reset operate on exactly the rendered Account list.
- Account requests execute sequentially in visible order.
- Busy state prevents duplicate submission.
- Per-Account waiting, success, domain outcome, failure, uncertain outcome, and not-attempted states remain explicit.
- An individual Account failure does not prevent later Accounts from running.
- Mutation requests are never retried automatically.
- A known accepted mutation is not presented as safe to retry because later rendering failed.
- The client works in embedded and standalone contexts, configured sidebar and expanded widths, light and dark themes, and supported browsers.
- Tests protect behavior and contracts rather than static wording or pixel snapshots.
- Browser verification confirms the target visually and interactively.

### Local gate

The target root check covers:

- strict client, server, and test typechecks;
- retained client and server unit tests;
- OpenAPI generation and generated client types;
- client and Worker production builds;
- formatting;
- generated-file drift.

It performs no remote mutation.

## Production patch synchronization

While GCP and GAS remain production-authoritative, every production patch must be:

1. identified by affected behavior;
2. recorded in the migration patch ledger;
3. characterized in a deterministic target test;
4. ported when its behavior area is implemented;
5. included in the next source drift audit.

Drift audits occur before preview routing, production deployment, each production cutover, and repository consolidation.

### Chunk 1 baseline evidence

- Persisted app identity, access policy, production and development menu routes, menu dimensions, production webhook route, all four event subscriptions, API version, and property schema match the preserved legacy configuration. Production routing remains on GAS and GCP.
- The active event deployment uses the declared Gen 2 Node.js 22 runtime, `doPost` entry point, 256 MiB memory, 360-second timeout, and ten-instance limit. Its effective request concurrency is one.
- The immutable GCF source archive and deployed runtime image contain the same package, lockfile, and all thirty generated JavaScript and source-map artifacts. The deployed build resolved Node.js 22.21.1, Yarn, TypeScript 4.9.5, `bkper-js` 2.18.0, `@bkper/bkper-api-types` 5.32.0, and Functions Framework 2.1.1.
- A frozen build of the current checked-in event source against the deployed lockfile passes all six deterministic tests. Twenty-two of its twenty-eight generated JavaScript and source-map artifacts match production byte-for-byte.
- The six differing common artifacts are `constants.js`, `InterceptorOrderProcessorDeleteFinancial.js`, `index.js`, and their source maps. Production also contains `EventHandlerTransactionUpdated.js` and its source map, which current source removed.
- The current tested COGS deletion hardening is explicitly accepted over the older deployed behavior. It recognizes current `#COGS`, legacy `#cost_of_sale`, and `quantity_sold` signals only for Inventory Bot Transactions with remote ids. This is an accepted source-over-deployment correction, not a parity claim.
- The deployed ingress requires its configured API key, while current source allows the provider to be absent. Platform authentication replaces both runtime-specific forms in Chunk 3; this difference does not authorize a domain behavior change.
- The deployed artifact contains `TRANSACTION_UPDATED` dispatch code, but the persisted app has no such subscription and current source intentionally removed the handler. The migration retains only the four persisted subscriptions and does not invent update behavior.
- The tracked event `package-lock.json` predates the deployed package declarations, and the tracked project omits the `yarn.lock` that its build copies. A normal install therefore resolves newer dependencies; the recovered immutable deployed lockfile remains the event dependency baseline.
- The production GAS menu is deployment version 17, release 2.3.0. Its manifest, static HTML, and all thirteen generated JavaScript bodies reproduce byte-for-byte from the preserved source using TypeScript 4.9.5. The manifest uses Bkper Apps Script library version 201.
- The GAS server build passes its four deterministic helper tests, and the client build regenerates the accepted production HTML. These tests do not constitute FIFO, Reset, authorization, or end-to-end accounting coverage.
- Shared documentation and licensing now live at the Inventory Bot root. The abandoned target was removed completely, leaving no inherited target implementation.
- Secret values, deployment and infrastructure identifiers, source-object identifiers, image identifiers, personal names, and raw command output are intentionally excluded from this roadmap.

### Migration patch ledger

| Surface | Behavior changed | Target test | Port status |
| --- | --- | --- | --- |
| GCF COGS deletion detection | Current source hardens generated COGS recognition over the older deployed `#cost_of_sale`-only behavior | Retained `InterceptorOrderProcessorDeleteFinancial` tests for `#COGS`, legacy marker, and `quantity_sold` | Ported with deletion behavior in Chunk 5 |

### Deferred inherited behavior ledger

| Surface | Inherited source behavior | Migration treatment |
| --- | --- | --- |
| Financial sale deletion classification | The source requires the deleted Transaction's destination Account to be `INCOMING`; the standard accepted sale direction has the `INCOMING` Account as origin, so that shape remains a no-op at this classifier | Preserve and test the source behavior during migration; any classifier correction is separate post-migration work |
| Inventory purchase and sale deletion classification | The source selects an item Account only when the destination is `INCOMING` or the origin is `OUTGOING`; the generated `Buy >> item` and `item >> Sell` movements do not satisfy those checks and remain no-ops at this classifier | Preserve and test the source behavior during migration; any classifier correction is separate post-migration work |

## Migration chunks

### Chunk 1 — Capture the production baseline and establish a clean parallel layout

**Status: Complete.**

**Objective:** Establish exactly what is running in production before replacing the abandoned target or porting behavior.

**Completed:**

- Confirmed persisted app identity, production and development routes, event subscriptions, API version, access policy, menu expressions, dimensions, and property schema.
- Captured the active GCP runtime, entry point, resource settings, immutable source artifact, dependency lock, runtime image, and build relationship to `legacy/events/`.
- Captured the active GAS deployment version, manifest, static asset, Bkper library version, generated JavaScript, and exact relationship to `legacy/menu/`.
- Ran the available deterministic tests and builds and recorded their limited coverage.
- Recorded source-versus-deployment drift and explicitly accepted the tested COGS deletion hardening.
- Preserved the legacy event and menu source for direct comparison.
- Removed the abandoned `new/` implementation completely; Chunk 2 will create the clean target.
- Moved shared public documentation and licensing to the Inventory Bot root without changing production behavior.

**Gate:** Both production surfaces are reproducible, production routing remains unchanged, and no inherited target implementation remains.

### Chunk 2 — Create the full-stack Cloudflare skeleton

**Status: Complete.**

**Objective:** Establish a minimal, deterministic Platform application with no Inventory Bot business mutations.

**Completed:**

- Created clean root, client, and server package boundaries from the current Bkper app architecture.
- Added strict TypeScript, Bun workspaces, exact dependency pins, formatting, generated environment types, OpenAPI generation, generated client types, and a committed lockfile.
- Added static client delivery, structured JSON `/api/v1/*` not-found behavior, `/openapi.json`, and `/events` in one Hono Worker.
- Kept `/events` as a body-agnostic, non-mutating no-op until event dispatch is introduced in Chunk 3.
- Kept the OpenAPI operation surface empty until the Account-level Calculate and Reset routes are defined in Chunk 7.
- Added the Lit, Vite, Web Awesome, Bkper design, `bkper-js`, and web-auth foundations with an immediate loading shell, structured states, typed service boundaries, and non-mutating operation components.
- Added deterministic client coverage for environment, authentication, HTTP, Book access, trusted embedded URL messages, application state, Account scope rendering, errors, permissions, and sequential operation orchestration.
- Configured Vite `5175` and Worker `8796` explicitly.
- Preserved the production GAS menu and GCP webhook routes without changing development or production routing.
- Removed template demo behavior and standalone health endpoints.
- Passed generated-contract checks, strict client and server typechecks, 94 unit tests, production client and Worker builds, formatting, and generated-file drift checks.
- Performed no app sync, deployment, installation, event replay, routing change, credential use, Book write, or legacy infrastructure mutation.

**Gate:** Passed. The complete local check succeeds with no Inventory Bot business mutation or remote operation.

### Chunk 3 — Port event ingress, dispatch, and common resolution boundaries

**Status: Complete.**

**Objective:** Reproduce event transport and shared selection behavior before adding event-side mutations.

**Completed:**

- Added typed event results and one explicit non-mutating handler boundary for each of the four subscribed events.
- Reproduced the four-event dispatch, unknown-event no-op, response normalization, stack-array ingress errors, shared-handler errors, warning extraction, logging, and handler construction.
- Created one request-scoped `Bkper` and app context for each delivery without OAuth-token, API-key, or agent-id providers.
- Ported common Inventory and Financial Book selection, exchange-code selection, Account and Group resolution, quantity parsing, remote-id matching, first-match behavior, Account queries, Book links, and purchase and sale predicates without redesigning their implementation.
- Preserved embedded event Book construction and Collection iteration order from the production-authoritative source.
- Adapted only optional Account lookup behavior: current `bkper-js` `404` errors are converted to the `undefined` result returned by the legacy SDK at that boundary; other errors continue to propagate.
- Added deterministic coverage for dispatch, request isolation, Platform authentication assumptions, response behavior, common orchestration, SDK models and payloads, first-match semantics, Amount parsing, lookup failures, aliases, and handler no-write behavior.
- Confirmed that the target event module contains no Account or Transaction mutation call.

**Gate:** Passed. Every subscribed event reaches the intended non-mutating handler, and common resource resolution has no unexplained legacy-to-target difference.

### Chunk 4 — Port checked purchase, sale, and credit-note quantity behavior

**Status: Complete.**

**Objective:** Migrate the event path that creates quantity movements in the Inventory Book.

**Completed:**

- Ported duplicate remote-id lookup, first-match behavior, and accepted existing-mirror responses without creating another movement.
- Ported purchase recognition, item Account and direct Group synchronization, `Buy` Account creation, and complete `Buy >> item` quantity movements.
- Ported sale recognition, item Account lookup or creation, `Sell` Account creation, and complete `item >> Sell` quantity movements.
- Ported quantity-bearing credit-note recognition and its accepted reverse `item >> Buy` quantity movement.
- Preserved accepted dates, quantities, descriptions, properties, exchange codes, order values, source values, remote ids, branch order, resource lookup order, mutation order, and response commentary.
- Ported historical-date rebuild flags, direct checked Inventory movement interception, and Inventory Bot agent loop prevention.
- Characterized missing, zero, incomplete, unsupported, mismatched, duplicate, and replay paths as non-balance-affecting.
- Adapted optional Account and Group lookups only by converting current `bkper-js` `404` errors to the `undefined` result used by the legacy SDK; other failures still propagate.
- Awaited required Account, Group, Transaction, and rebuild mutations before returning the Worker response.
- Added deterministic checked-event coverage for exact resource payloads, complete movement direction, account synchronization, mutation ordering, idempotency, rebuild warnings, loop prevention, and no-write paths.
- Passed strict client and server typechecks, 129 unit tests, production client and Worker builds, formatting, and generated-file drift checks.
- Performed no app sync, deployment, installation, event replay, routing change, credential use, Book write, or legacy infrastructure mutation.

**Zero-sum gate:** Passed deterministically. Every posted quantity mirror is one complete movement with the accepted direction, and unresolved behavior creates no balance-affecting movement.

### Chunk 5 — Port posting, unchecking, deletion, and linked cleanup

**Status: Complete.**

**Objective:** Complete the transaction lifecycle behavior covered by the remaining event subscriptions.

**Completed:**

- Ported direct Inventory Book posting prevention with the accepted lookup, checked-state uncheck, trash, warning, and no-op behavior.
- Reused the checked-path rebuild interceptor for manual Inventory Book unchecking, preserving app-agent loop prevention and awaited Account updates.
- Ported Financial Book deletion classification for purchases, sales, additional costs, credit notes, and generated COGS.
- Ported remote Inventory movement deletion, split purchase cascade cleanup, linked COGS cleanup, rebuild decisions, result formatting, and first-match behavior.
- Ported Inventory Book deletion classification and linked Financial COGS cleanup without changing inherited source predicates.
- Retained the accepted current-source COGS deletion hardening for `#COGS`, legacy `#cost_of_sale`, and `quantity_sold`, including Inventory Bot agent and remote-id requirements.
- Preserved lookup, uncheck, trash, rebuild, and response order; sequential cleanup stops at the first failure exactly as the source does.
- Adapted only optional Account lookups: current `bkper-js` `404` errors become the absence returned by the legacy SDK, while other failures propagate.
- Awaited required uncheck, trash, Account update, and linked cleanup work before returning from the Worker handler.
- Characterized and retained the inherited Financial and Inventory deletion classifier no-ops in the deferred behavior ledger rather than silently correcting business logic.
- Added deterministic lifecycle coverage that forbids Account creation and Transaction posting during deletion, verifies exact movement removal and rebuild order, protects missing-resource no-ops, and records the partial-failure boundary.
- Passed strict client and server typechecks, 142 unit tests, production client and Worker builds, formatting, and generated-file drift checks.
- Performed no app sync, deployment, installation, event replay, routing change, credential use, Book write, or legacy infrastructure mutation.

**Gate:** Passed deterministically. No unexplained target-to-source difference remains in lifecycle selection, movement state, linked cleanup, rebuild state, mutation order, or responses; deletion creates no replacement or incomplete movement.

### Chunk 6 — Complete the event parity and drift audit

**Status: Not started.**

**Objective:** Freeze the event-side migration before beginning menu accounting work.

**Steps:**

- Execute the complete deterministic event matrix.
- Compare every target event handler and service with the production-authoritative legacy source.
- Build explicit subscribed-event and cross-event safety matrices linking legacy source, target source, and deterministic evidence.
- Classify every observed difference as parity, accepted target-runtime adaptation, inherited issue, production patch, or unresolved blocker.
- Audit movement completeness, direction, amount, state, remote ids, duplicates, cleanup, and loop prevention.
- Audit exact dependency resolution, generated artifacts, Worker bundle contents, and metadata.
- Reconcile the migration patch ledger.

**Gate:** No unexplained event-side difference remains, and every created or changed posted movement preserves the zero-sum invariant.

### Chunk 7 — Define the typed public menu API contract

**Status: Not started.**

**Objective:** Establish the reusable Account-level API boundary without implementing accounting mutations.

**Steps:**

- Define versioned Calculate and Reset Account-level routes.
- Define concrete request validation, shared `{ message: string }` success responses, and structured errors.
- Define the Inventory Book path resource, item Account resource, and corresponding Financial Book operation context.
- Define explicit permission and installation requirements for every mutation target.
- Keep Account and Group menu selection and generic read-only context on direct authenticated Bkper client reads.
- Add thin routes backed by non-mutating service stubs.
- Publish OpenAPI and generate the client contract.
- Add focused route, schema, error, and OpenAPI tests.

**Gate:** API and generated-contract tests protect the intended public surface while every operation remains non-mutating.

### Chunk 8 — Port client context, operation scope, and authorization boundaries

**Status: Not started.**

**Objective:** Resolve the exact visible Account scope and establish complete pre-mutation security without implementing Calculate or Reset.

**Steps:**

- Port originating Book, Inventory Book, selected Account, and selected Group resolution through authenticated browser-side `bkper-js`.
- Port eligible item Account selection, Account-over-Group precedence, whole-Book fallback, and deterministic alphabetical ordering.
- Make the rendered Account list the single client operation scope for Calculate and Reset.
- Port Financial Book resolution for every visible item Account.
- Add view, edit, installation, pending-task, lock, closing, missing-resource, and unsupported-context states.
- Check complete-scope availability before starting an Account sequence.
- Add shared server operation-context resolution for Inventory Book, item Account, and Financial Book.
- Enforce `EDITOR` or `OWNER` permission and Inventory Bot installation on every mutation target before invoking the still-non-mutating operation stub.
- Keep Bkper Core authoritative after preflight.

**Gate:** Deterministic fixtures produce the accepted visible Account list, and denied Account-level requests perform no Account or Transaction mutation.

### Chunk 9 — Port Reset

**Status: Not started.**

**Objective:** Migrate Account-level Reset before Calculate because Calculate can invoke Reset when rebuild is required.

**Steps:**

- Port Reset support constants, Account state behavior, transaction queries, purchase and sale recognition, and result summaries.
- Port the Reset mutation processor with its established maps, deduplication, locked-Transaction detection, and ordered Financial-trash, Inventory-update, and Inventory-trash phases.
- Port complete Account transaction loading and accepted source iteration order.
- Port linked COGS lookup and cleanup.
- Port sale property cleanup and checked-state restoration.
- Port split purchase trashing and parent quantity, cost, and property restoration.
- Port credit-note state restoration.
- Preserve locked-path no-write behavior and update Account calculation and rebuild state only after successful Transaction phases.
- Keep parity behavior unwired until deterministic Account-level coverage passes.
- Wire Reset through the authorized API facade and shared operation response without adding mutation receipts.

**Zero-sum gate:** Reset leaves no unintended active generated movement, restores accepted FIFO source state, and performs no mutation when preflight or lock requirements fail.

### Chunk 10 — Port Calculate

**Status: Not started.**

**Objective:** Migrate Account-level FIFO COGS calculation without redesigning its accounting behavior.

**Steps:**

- Port Calculate support types, Account state behavior, date handling, transaction queries, and result summaries.
- Port FIFO comparison by date, explicit order, and creation order.
- Port the Calculate mutation processor with generated ids, deduplication, locked-Transaction detection, and ordered Inventory-create, Inventory-update, and Financial-create phases.
- Port Account-level orchestration, including default calculation date, rebuild Reset-and-return, Financial Book resolution, complete transaction loading, unchecked filtering, quantity totals, and failure outcomes.
- Port quantity-bearing credit-note processing before sales.
- Port complete-lot and partial-lot FIFO behavior, purchase splitting, parent ids, checked state, purchase logs, and liquidation logs.
- Port additional-cost and credit-amount lookup and cost allocation.
- Port total-cost and per-unit cost arithmetic with accepted precision.
- Port COGS Account lookup or creation and complete `item >> Cost of goods sold` monetary movements.
- Preserve remote ids, sale references, quantity properties, descriptions, checked state, and operation phase order.
- Keep parity behavior unwired until the complete deterministic FIFO matrix passes.
- Wire Calculate through the authorized API facade and shared operation response without adding mutation receipts.

**Zero-sum gate:** Every generated COGS result is a complete movement with the accepted amount and direction; failed preflight and locked paths perform no accounting mutation.

### Chunk 11 — Port and modernize the menu client

**Status: Not started.**

**Objective:** Replace the GAS UI and bulk RPC with a production-quality client consuming the typed Account-level API.

**Steps:**

- Build an immediate app shell, authentication states, context header, visible Account list, operation controls, and help affordances.
- Use Web Awesome components and Bkper design tokens.
- Wire Calculate and Reset through dedicated controllers and the generated authenticated API client.
- Check Inventory Book pending tasks once at action time before the first Account request.
- Execute Accounts sequentially in visible order.
- Continue after individual Account failures while never retrying a mutation automatically.
- Show waiting, running, completed, domain outcome, failed, uncertain, and not-attempted states per Account.
- Keep controls disabled during an active sequence and prevent duplicate submission.
- Use the same visible Account list for Calculate and Reset.
- Do not add a Reset confirmation dialog.
- Handle trusted embedded Book URL changes without leaving stale actionable context.
- Support standalone and embedded rendering, configured sidebar and expanded widths, keyboard use, accessibility, and light and dark themes.
- Visually verify the completed client once after implementation.

**Gate:** The client behavior matrix passes, the intended workflow is usable in Bkper context, and no UI path silently changes operation scope or retries a mutation.

### Chunk 12 — Complete the full-stack behavior, dependency, and runtime audit

**Status: Not started.**

**Objective:** Freeze a locally reproducible candidate before any preview deployment or routing.

**Steps:**

- Install from the frozen lockfile and run the complete generated-contract, typecheck, test, build, format, and drift gate.
- Reconcile all four event routes and event behavior with the production-authoritative GCP source.
- Reconcile context, Calculate, Reset, summaries, operation ordering, and client orchestration with the production-authoritative GAS source and accepted target decisions.
- Confirm every mutation route validates input, resolves complete context, authorizes every target, verifies installation, and completes preflight before its first write.
- Confirm Account execution is sequential, later Accounts continue after isolated failures, and mutations are never retried automatically.
- Audit asynchronous completion, pagination, SDK compatibility, errors, retries, dependencies, bundle contents, and metadata.
- Rebuild from clean output and compare generated deployment artifacts for reproducibility.
- Reconcile the production patch and accepted-deviation ledgers.

**Gate:** Event parity is explained, menu accounting coverage is complete, target differences are documented, and the candidate is reproducible.

### Chunk 13 — Deploy to preview and establish routing readiness

**Status: Not started.**

**Objective:** Make the frozen candidate available for controlled validation without changing production authority.

**Steps:**

- Rebuild from a clean frozen install and pass the complete local gate.
- Review the exact metadata and deployment diff.
- Narrow developer access when needed so only controlled activity reaches development event routing.
- Deploy the accepted candidate to preview through separately approved operations.
- Route the development menu and development events independently to preview while production remains on GAS and GCP.
- Establish an isolated Collection with one Inventory Book and representative Financial Books.
- Install the required apps only through separately approved operations.
- Verify authentication, static assets, OpenAPI, API protection, read-only context, event ingress, no-op behavior, and logs without creating an accounting movement.

**Gate:** Both preview surfaces are reachable and protected while production remains entirely on GCP and GAS.

### Chunk 14 — Validate preview event behavior

**Status: Not started.**

**Objective:** Prove event-side quantity and lifecycle behavior against authoritative Book state in isolated Books.

**Steps:**

- Exercise eligible purchase, sale, and quantity-bearing credit-note mirroring.
- Exercise missing quantity, zero quantity, unsupported input, mismatched exchange, duplicate delivery, and app-agent loop prevention.
- Exercise direct Inventory Book posting prevention and manual uncheck rebuild behavior.
- Exercise Financial and Inventory deletion paths, split cleanup, linked COGS cleanup, and rebuild flags.
- Verify created resources through canonical re-reads rather than event responses alone.
- Assert exact movement direction, amount, state, properties, remote ids, uniqueness, and linked cleanup.
- Deterministically aggregate movement effects and confirm each Book remains zero-sum.
- Re-run the complete local gate after any accepted preview correction.

**Gate:** No duplicate, missing, reversed, partial, orphaned, or imbalanced active movement is found.

### Chunk 15 — Validate preview menu, Calculate, Reset, and live context

**Status: Not started.**

**Objective:** Accept the complete user workflow and resulting accounting behavior before production deployment.

**Steps:**

- Validate authenticated Book, Account, Group, and whole-Book context in the installed preview.
- Validate trusted embedded context changes and stale-context protection.
- Validate the visible Account list and identical Calculate and Reset scope.
- Validate permission, installation, pending-task, lock, closing, missing-resource, and unsupported-context states.
- Exercise deterministic complete-lot and partial-lot FIFO scenarios.
- Exercise multiple purchases, multiple sales, explicit same-date ordering, quantity-bearing credit notes, additional costs, credit amounts, and rebuild Reset-and-return behavior.
- Verify purchase splits, parent ids, logs, checked state, Account calculation state, and generated COGS.
- Exercise Reset and verify COGS cleanup, split cleanup, parent restoration, checked state, properties, and Account state.
- Exercise an individual Account failure and confirm later visible Accounts continue sequentially without retrying the failed mutation.
- Verify every accepted accounting outcome from authoritative Book resources and deterministic per-Account movement aggregation.
- Confirm every active movement is complete, linked resources are unique, and every participating Book remains zero-sum.
- Complete visual and interactive acceptance in configured Bkper contexts and themes.

**Gate:** Target workflows, FIFO outcomes, Reset outcomes, operation scope, failure behavior, and embedded context are accepted with no unexplained accounting difference.

### Chunk 16 — Complete the final drift audit and deploy production runtime

**Status: Not started.**

**Objective:** Deploy the accepted Worker without changing production menu or event routing.

**Steps:**

- Repeat the GCP and GAS source and deployed-artifact audits.
- Reconcile every production patch and accepted deviation.
- Remove dependencies and build output, reinstall from the frozen lockfile, and pass the complete local gate.
- Reproduce generated deployment artifacts from clean builds.
- Review exact dependency pins, advisories, bundle contents, configuration, and generated contracts.
- Deploy the accepted Worker to production through a separately approved operation while production routes remain on GCP and GAS.
- Verify production runtime availability, OpenAPI, API protection, authenticated client boundary, assets, and logs without a deliberate Book mutation.

**Gate:** Deployment changes runtime availability only; GCP and GAS remain production-authoritative.

### Chunk 17 — Cut over the production webhook and stabilize events

**Status: Not started.**

**Objective:** Make Cloudflare production-authoritative for events while keeping the GAS menu and GCP rollback target unchanged.

**Steps:**

- Review the exact webhook-only metadata change and obtain explicit approval.
- Change only the production webhook route to Cloudflare.
- Confirm persisted routing and production event ingress.
- Monitor requests, responses, authentication, runtime, dependencies, and customer-impact reports during the accepted stabilization window.
- Use deterministic and preview evidence for accounting correctness; HTTP success alone is not movement proof.
- Keep the production menu on GAS and the unchanged GCP handler available for immediate routing rollback.
- Reconcile any event whose mutation outcome is uncertain before replaying or retrying it.

**Rollback triggers:** suspected zero-sum or data-loss issue, reversed or partial quantity movement, duplicate mirroring, missing linked cleanup, sustained authentication failure, material error or runtime growth, or missing production behavior.

**Gate:** Cloudflare remains production-authoritative for events through the accepted stabilization period with no rollback trigger.

### Chunk 18 — Cut over the production menu and stabilize the full stack

**Status: Not started.**

**Objective:** Make the Cloudflare client and API production-authoritative after event stabilization.

**Steps:**

- Review the exact menu-only metadata change and obtain explicit approval.
- Change only the production menu route to Cloudflare.
- Keep Cloudflare authoritative for events and GAS available for menu rollback.
- Confirm authentication, context, visible Account scope, permissions, installation, operation availability, and API protection.
- Monitor client failures, API outcomes, runtime, authentication, and customer-impact reports during the accepted stabilization window.
- Do not initiate customer Book writes solely for monitoring.
- Treat uncertain mutation outcomes as requiring authoritative review before retry.

**Rollback triggers:** suspected zero-sum or data-loss issue, incorrect quantity or COGS movement, wrong Account scope, failed Reset restoration, sustained authentication or API failure, unacceptable runtime, material errors, or unusable workflow.

**Gate:** Cloudflare remains production-authoritative for both events and the menu through the accepted stabilization period.

### Chunk 19 — Consolidate the repository and defer legacy retirement

**Status: Not started.**

**Objective:** Make the accepted Cloudflare application the only active working-tree implementation without changing remote state.

**Steps:**

- Move the accepted Cloudflare project from `new/` to the Inventory Bot root.
- Remove inactive legacy working-tree source and obsolete local GCP and GAS tooling.
- Update workspace instructions, scripts, port documentation, and forwarding.
- Restore normal developer access after controlled migration routing is complete.
- Verify source, tests, lockfile, configuration, generated contracts, assets, and Worker bundle through the move.
- Compare retained target files before and after relocation.
- Run the complete local gate from the final root layout.
- Preserve legacy source in Git history and deployed runtimes as independent routing rollback targets.
- Perform no deployment, routing change, Book write, event replay, or legacy infrastructure deletion as part of consolidation.

**Gate:** Cloudflare is the only active implementation in the project root, and consolidation changes no application behavior or remote state.

## Rollback strategy

### Event rollback

The retained GCP function can receive production events again through a configuration-only webhook change.

1. Stop and identify the trigger.
2. Restore the retained GCP webhook in app metadata.
3. Review the exact configuration diff and remote sync command.
4. Obtain explicit approval before syncing.
5. Confirm persisted routing and inspect event handling.
6. Keep Cloudflare deployed for incident analysis.
7. Reconcile affected quantity, split, COGS, and rebuild state if an event lifecycle may have stopped partway.

### Menu rollback

The retained GAS deployment can serve the production menu again through a configuration-only menu URL change.

1. Stop and identify the trigger.
2. Restore the retained GAS menu URL in app metadata.
3. Review the exact configuration diff and remote sync command.
4. Obtain explicit approval before syncing.
5. Confirm persisted routing and menu access.
6. Keep Cloudflare deployed for incident analysis.
7. Reconcile any Calculate or Reset operation whose accepted mutation outcome is unclear before retrying it.

After repository consolidation, rebuilding either legacy deployment requires recovering its source from Git history and a separate reviewed incident plan.

## Completion definition

### Event migration complete

- Cloudflare handles production Inventory Bot events.
- All four subscribed behaviors have deterministic parity coverage.
- Quantity movement direction, amount, state, relationships, lifecycle, idempotency, and zero-sum checks pass.
- Preview, cutover, and event stabilization gates pass.

### Full-stack migration complete

- Cloudflare serves the production Inventory Bot client and authenticated public API.
- Calculate and Reset retain deterministic accounting safeguards.
- The visible Account list is authoritative for both operations.
- Account operations execute sequentially, continue after individual failure, and are never retried automatically.
- Accepted API, runtime, workflow, and UI differences are documented instead of mislabeled as full parity.
- Client visual and interactive verification passes.
- Preview, menu cutover, and full-stack stabilization gates pass.
- The Cloudflare application occupies the Inventory Bot root.
- GCP and GAS remain available as independent routing rollback targets.

### Legacy infrastructure retirement deferred

Deleting the retained GCP function, GAS project or deployment, source artifacts, IAM bindings, properties, credentials, or related infrastructure requires a future plan and explicit approval. Time elapsed alone is not a retirement criterion.

## Optional post-migration work

Any intentional FIFO correction, lifecycle redesign, account-synchronization change, operation-scope expansion, checked-transaction update support, API evolution, client workflow change, concurrency change, automatic retry policy, dependency modernization, shared-service extraction, or legacy infrastructure retirement remains separate from migration completion.

Inherited issues discovered during migration are recorded separately and addressed after stabilization with their own tests, preview evidence, rollout plan, and explicit approval. Every accounting change must continue to preserve complete resource movements and Bkper's zero-sum invariant.
