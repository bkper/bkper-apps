# Portfolio Bot: GCP and Apps Script to Cloudflare Migration Roadmap

## Status

**Chunks 1–4 complete — Chunk 5 not started.**

The production baseline is recorded, the event-routing drift has been explicitly resolved in favor of the current `EventHandlerGroupDeleted` behavior, the unchanged legacy projects are isolated under `legacy/`, and the full-stack Cloudflare skeleton, deterministic event dispatcher, shared event orchestration, and common resolution boundaries are established under `new/`. Individual event handlers remain explicit no-op behavior stubs until their behavior chunks. Production routing remains unchanged.

The Google Cloud Function remains production-authoritative for events. The Google Apps Script web app remains production-authoritative for the Portfolio Bot menu.

## Purpose of this document

Portfolio Bot will follow the full-stack migration process proven by Exchange Bot: migrate events and the menu into one Bkper Platform application, validate the Cloudflare target in parallel, cut over the webhook and menu independently, stabilize both surfaces, and retain the legacy deployments as separate routing rollback targets.

Portfolio Bot is larger, especially on the GAS side, but that does not change the migration process or its main decisions.

This is a public, community-facing roadmap. It records technical decisions and reproducible outcomes without retaining raw operational logs, Book or resource identifiers, internal infrastructure identifiers, personal names, secret values, or routine approval chronology.

## Objective

Migrate the published `stock-bot` app from:

- a Google Cloud Function that handles Bkper events; and
- a Google Apps Script web app that provides the Portfolio Bot menu and its server operations;

into one Bkper Platform application whose Cloudflare Worker serves:

- the bundled browser client;
- authenticated `/api/v1/*` routes used by that client;
- Bkper event ingress at `/events`;
- the generated OpenAPI contract at `/openapi.json`.

The standalone scaffold health route is not part of the application contract.

The event handler targets maximum practical code and behavior parity. The GAS menu does not: moving from server-rendered GAS, synchronous `bkper-gs`, and `google.script.run` to Lit, Hono, and asynchronous `bkper-js` necessarily changes the architecture, API boundary, and UI implementation.

The menu migration preserves accepted accounting outcomes and essential workflows while delivering a production-quality target client. It does not claim source-code or pixel-level UI parity.

## Non-negotiable invariants

1. **Protect Bkper's zero-sum invariant above all else.** Every posted Transaction created or changed by Portfolio Bot must remain one complete movement with one amount from an origin Account to a destination Account.
2. **Protect each Book independently.** Quantity movements in the Portfolio Book and monetary movements in Financial and Base Books must each balance within their own Book.
3. **Incomplete movements remain non-balance-affecting.** Missing Accounts, cleared zero amounts, and unresolved movements retain their established draft or no-op behavior.
4. **Preserve movement meaning.** Purchases, sales, fees, interest, realized results, exchange results, MTM entries, forwarded results, and liquidation bridges retain their accepted direction and resource meaning.
5. **Preserve relationships and idempotency.** Remote ids, parent ids, split relationships, and linked lifecycle behavior must not create duplicate active movements.
6. **The legacy implementations remain authoritative until their respective cutovers.** Production patches during migration must be characterized and ported.
7. **Do not mix migration with silent business-logic fixes.** Record inherited issues for separate work unless a target-runtime or security requirement forces an explicit deviation.
8. **Tests never write to live Books.** Deterministic tests intercept SDK, network, API, browser, clock, and UUID boundaries.
9. **Deployment and routing remain separate.** A deployed Worker does not imply that production events or the menu should route to it.
10. **Webhook and menu cutovers remain independent.** Each has its own validation, stabilization, and rollback decision.
11. **Remote mutations require explicit approval.** App sync, deploy, installation, event replay, routing changes, canaries, and Book writes are reviewed separately immediately before execution.
12. **Do not claim full parity.** Completion means accepted domain behavior coverage, documented target differences, and successful rollout evidence.

## Authoritative legacy surfaces

### GCP event handler

The current `gcf/` project is authoritative for the thirteen subscribed event types.

It handles:

- purchase and sale order splitting;
- fees, interest, and instrument movements;
- checked quantity mirroring into the Portfolio Book;
- transaction update, uncheck, deletion, and restoration;
- linked realized, MTM, historical, and FX cleanup;
- rebuild flags;
- Account and Group synchronization;
- selected Book updates;
- event responses and loop prevention.

### Google Apps Script web app

The current `gas/` project is authoritative for the accepted Portfolio Bot menu behavior and accounting operations.

It handles:

- Book, Account, and Group context;
- eligible and uncalculated Account selection;
- permissions and pending-task validation;
- FIFO realized-result calculation;
- complete and partial lots;
- short sales;
- historical, fair, and combined models;
- realized, exchange, MTM, and interest-MTM movements;
- Reset and Full Reset;
- Forward Date and lower-date repair;
- Portfolio Book closing-date updates;
- per-Account progress and results.

The accepted source and deployed artifacts, not README interpretations, define the migration baseline.

## Domain behavior preserved

Portfolio Bot coordinates one Portfolio Book, one or more Financial Books, and an optional configured Base Book in the same Collection.

- Posted purchase and sale orders retain their recognition rules, amount calculations, dates, descriptions, properties, Account creation, remote ids, and movement direction.
- Fees and interest retain their separate movements.
- Checked instrument trades retain their quantity mirror in the Portfolio Book.
- Portfolio purchases remain movements from `Buy` to the instrument Account; sales remain movements from the instrument Account to `Sell`.
- Mirrored quantities, prices, historical prices, trade rates, order, original values, dates, descriptions, currency properties, and remote ids retain accepted semantics.
- Transaction update, uncheck, deletion, and restoration retain their accepted linked behavior and state transitions.
- Account, Group, and Book synchronization retain their accepted direction, eligibility, lookup, rename, archive, property, and removal behavior.
- Group hierarchy remains outside the synchronization contract.
- Calculate retains FIFO order, complete and partial lot handling, short sales, split Transactions, logs, checked state, and model-specific behavior.
- Realized, historical, exchange, MTM, historical MTM, interest-MTM, and forwarded-result movements retain accepted amounts, direction, Accounts, properties, descriptions, and remote ids.
- Support Account lookup, creation, type inference, and Group inference retain accepted behavior.
- Calculate retains its accepted mutation phases across Portfolio, Financial, and Base Books.
- Reset retains linked cleanup, parent restoration, property cleanup, checked-state handling, Account dates, and rebuild behavior.
- Full Reset additionally retains forward-state removal and historical-state restoration.
- Forward Date retains its validations, forward logs, liquidation bridge, forwarded result, Account properties, and optional Portfolio Book closing date.
- Lowering a forward date retains its owner, unlocked-Collection, reset, repair, and re-forward requirements.
- Exchange Bot events retain their accepted skip behavior.

## Migration fidelity rules

### Event-side rules

- Preserve source class, function, method, and parameter names where practical.
- Preserve class decomposition, branch order, lookup order, mutation order, return normalization, logging, concurrency, and side effects.
- Do not refactor, modernize, optimize, or clean up event business behavior during the parity port.
- Limit mechanical changes to runtime boundaries, module syntax, strict TypeScript, request-scoped Platform authentication, SDK compatibility, and build packaging.
- Compare the GCP and target implementations side by side before completing each event chunk.
- Characterize runtime-sensitive unawaited legacy operations and ensure required Cloudflare work completes before the request ends.
- Record every retained deviation.
- Stop and escalate any adaptation that can change movement direction, amount, state, linked cleanup, or the zero-sum invariant.

### Menu, API, and client rules

- Preserve accounting outcomes, operation ordering, selected resources, and essential workflows—not GAS source structure.
- Treat `/api/v1/*` as a new reusable extraction, not a legacy transport contract.
- Keep API routes thin and move accounting behavior into server services.
- Use explicit schemas, authorization, errors, and generated client types.
- Replace synchronous `bkper-gs` with asynchronous `bkper-js` deliberately, preserving mutation order where accounting behavior depends on it.
- Do not preserve GAS UI structure or styling for its own sake.
- Use the Bkper design foundation and deliver a responsive, accessible, theme-aware, production-quality client.
- Allow client UX improvements when they do not silently change selected Accounts, dates, options, mutation requests, or accounting outcomes.
- Document material API, runtime, workflow, and UI differences instead of labeling them as parity.

## Architecture

### Original layout

```text
portfolio-bot/
├── gcf/         # GCP event handler
├── gas/         # Apps Script menu and server operations
├── images/
├── bkper.yaml
├── package.json
├── README.md
└── LICENSE
```

### Temporary migration layout

```text
portfolio-bot/
├── legacy/
│   ├── gcf/     # production-authoritative event implementation
│   ├── gas/     # production-authoritative menu implementation
│   ├── bkper.yaml
│   └── package.json
├── new/
│   ├── client/  # Vite + Lit browser client
│   ├── server/  # Hono Worker: /api/v1/*, /events, OpenAPI, assets
│   ├── bkper.yaml
│   ├── package.json
│   └── tsconfig.json
├── ROADMAP.md
├── README.md
└── LICENSE
```

The target metadata keeps production `menuUrl` and `webhookUrl` on Apps Script and GCP while development URLs can move independently to Cloudflare preview. The target `new/bkper.yaml` must preserve the unpublished app's production access policy with `users: '*@brain.uy'`, and that policy must remain in the root `bkper.yaml` after consolidation.

### Intended final layout

```text
portfolio-bot/
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

The previous GCP and GAS source remains recoverable from Git history. Their unchanged deployments remain independent routing rollback targets until separately retired.

## Cloudflare target decisions

- One full-stack Worker serves static client assets, authenticated `/api/v1/*`, `/events`, and `/openapi.json`.
- The Worker exposes no standalone health endpoint.
- The client uses Lit, Vite, Web Awesome, `@bkper/web-design`, and `@bkper/web-auth`.
- The client may use browser-side `bkper-js` for authenticated Book context and read-only UI behavior.
- Calculate, Reset, Full Reset, and Forward Date mutations run through authenticated server API routes.
- The initial API remains limited to the operations and context required by Portfolio Bot.
- API authorization and installation checks are explicit and do not rely only on hidden client controls.
- Every mutating operation resolves and preflights the Portfolio, Financial, and Base Books it may change before its first write.
- Full Reset and lower-forward-date requirements are enforced at the server boundary.
- Bkper Core remains authoritative for every request after the application preflight.
- Server routes and event handlers create request-scoped `Bkper` instances without OAuth, API-key, or agent-id providers.
- Worker code never reads or forwards `Authorization`, `bkper-oauth-token`, or `bkper-agent-id`.
- Event-side and menu-side business behavior remain separate during migration.
- Independent read-only loading and validation requests use explicit bounded batching while preserving deterministic result and mutation order.
- No KV or secret is introduced unless implementation evidence establishes a requirement.
- Strict TypeScript, Bun, exact dependency pins, a committed lockfile, deterministic tests, production builds, formatting, and generated-contract checks form the local gate.
- Before development events route to preview, developer access is temporarily narrowed to the migration operator so only controlled activity reaches the target.
- Local ports use Vite `5179` and Worker `8797`.

## Open implementation-time decisions

### SDK and tooling versions

The repository declares GCF `bkper-js` `^2.18.0` without a committed lockfile. The GAS project uses a pinned Apps Script library deployment and version-ranged local type packages.

The migration baseline must establish the exact deployed GCF dependency and GAS artifacts before selecting the target SDK pin.

The compatibility audit covers:

- nullable lookups versus propagated 404 errors;
- complete-chart Account and Group caching;
- Amount parsing, absolute-value, zero-clearing, arithmetic, comparison, and rounding;
- Book date, timezone, fraction-digit, lock, and closing behavior;
- transaction pagination, ordering, and first-match semantics;
- batch create, update, trash, and check serialization and result order;
- checked, locked, posted, draft, and trashed transitions;
- visible and hidden properties;
- remote ids;
- balance reports;
- retries, errors, and Platform authentication.

Exact Bkper CLI, TypeScript, Miniflare, browser, and supporting versions are pinned in the committed lockfile after their compatibility checks.

### API contract

The exact route names, payloads, operation grouping, preflight placement, and response schemas are defined in the typed API chunk.

The contract remains small: context and validation required by the client plus Calculate, Reset, Full Reset, and Forward Date. It must preserve safe operation ordering without carrying `google.script.run` implementation details into the public API.

### Client behavior

The target client preserves the operational purpose of the GAS menu but may improve navigation, validation, progress, results, permissions, errors, responsiveness, accessibility, themes, and embedded behavior.

The accepted client is verified as a target application, not compared pixel-for-pixel with GAS.

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

- Every subscribed event and the unknown-event path retain accepted routing and responses.
- Each request receives isolated SDK context and Platform authentication.
- Portfolio, Financial, and Base Book discovery retain accepted ordering and fallbacks.
- Currency, Group, Account, calculation-model, and realized-date rules retain accepted behavior.

#### Order splitting and quantity movements

- Purchase and sale recognition retain established property and Account requirements.
- Fees, interest, and instrument movements retain amount, direction, date, description, properties, Accounts, and remote ids.
- Checked instrument movements create one eligible Portfolio quantity mirror in the established direction.
- Missing, zero, unsupported, duplicate, and Exchange Bot paths retain accepted behavior.
- Every posted movement is complete; unresolved behavior remains non-balance-affecting.

#### Lifecycle and synchronization

- Update, uncheck, delete, and restore retain checked-state, rebuild, linked lookup, cleanup, and response behavior.
- Account create, update, rename, archive, Group membership, and delete retain accepted direction and eligibility.
- Group create, update, rename, hidden state, properties, and delete retain accepted behavior without hierarchy synchronization.
- Book updates retain accepted mode and Portfolio Book behavior.
- Resource synchronization creates no transaction movement.

### Menu behavior matrix

#### Context and permissions

- Book, Account, and Group context resolve to the accepted Portfolio Book and instrument Accounts.
- Uncalculated Account discovery, sorting, no-context behavior, and default date retain accepted outcomes.
- Edit permissions, Full Reset eligibility, pending tasks, locks, closing dates, and installation produce explicit target states.
- Each mutating API operation identifies every Portfolio, Financial, and Base Book it may change and preflights the required permission on all of them.
- Unauthorized API operations fail before any Account, Transaction, or Book mutation begins.

#### Calculate

- FIFO sorting, complete and partial lots, short sales, splits, logs, parent ids, checked state, and model branches retain accepted outcomes.
- Explicit and inherited rates retain accepted precedence.
- Realized, historical, FX, MTM, historical MTM, and interest-MTM movements retain amount, direction, Accounts, properties, descriptions, and remote ids.
- Support Account lookup, creation, type, and Group inference retain accepted behavior.
- Portfolio splits receive canonical ids before dependent Financial and Base Book movements are created.
- Batch phases and result order remain deterministic.
- Locked or unresolved paths do not create an unintended posted movement.

#### Reset, Full Reset, and Forward Date

- Reset retains linked cleanup, checked-state handling, split cleanup, original-state restoration, Account dates, and rebuild behavior.
- Full Reset additionally removes accepted forward state and restores historical state.
- Forward Date retains validation, balances, logs, liquidation bridge, forwarded result, Account properties, and optional closing date.
- Lower-forward-date repair retains owner and unlocked-Collection requirements.
- Every accepted result remains a complete movement in its Book.

### Client behavior matrix

- Authentication and login-required behavior use `@bkper/web-auth`.
- URL context produces the accepted Book, Account, and Group scope.
- Calculate, Reset, Full Reset, and Forward Date expose the accepted inputs and availability.
- Busy state prevents duplicate submission.
- Per-Account progress, results, warnings, and errors remain explicit.
- A known accepted mutation is not presented as safe to retry because later summary rendering failed.
- The client works in embedded and standalone contexts, responsive layouts, light and dark themes, and supported browsers.
- Tests protect behavior and contracts rather than static wording or pixel snapshots.
- Browser verification confirms the target client visually and interactively.

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

- Persisted app identity, production and development menu routes, production webhook route, all thirteen event subscriptions, API version, and property schema match the checked-in configuration.
- The active GCF deployment uses the declared Gen 2 Node.js 22 runtime, entry point, memory, CPU, timeout, and maximum-instance settings. Its immutable build used Node.js 22.22.0, Yarn, TypeScript 4.9.5, and `bkper-js` 2.18.0.
- The deployed GCF package and lockfile were recovered from the immutable runtime image. A frozen reproduction compiled successfully, and 48 of 50 generated JavaScript and source-map artifacts matched production byte-for-byte.
- The two differing GCF artifacts are `index.js` and its source map. Production routes `GROUP_DELETED` through `EventHandlerGroupCreatedOrUpdated`; current project code routes it through `EventHandlerGroupDeleted`. No other deployed event artifact differs from a frozen build of the current project source.
- The current `EventHandlerGroupDeleted` behavior is the explicitly accepted migration baseline: remove the matching Portfolio Book group, or perform no mutation when it is absent. The target test must characterize this behavior rather than reproduce the older production routing mistake.
- The production GAS menu uses immutable application version 1.16.0. Its manifest, HTML asset, and all fourteen generated JavaScript bodies match the checked-in source. The deployed output used TypeScript 4.9.5 and Bkper Apps Script library version 201.
- Neither legacy project defines a test script. GAS defines no local build script. The GCF frozen reproduction is build evidence, not behavioral test coverage.
- After the move, the legacy GCF build completed successfully and the GAS project still resolves all sixteen expected source files. Because the GCF has no committed lockfile, a fresh local build resolved `bkper-js` 2.43.1 rather than the deployed 2.18.0; the immutable deployed lockfile remains the migration baseline.
- Runtime secret values, deployment identifiers, source-object identifiers, image identifiers, project numbers, and raw command output are intentionally excluded from this roadmap.

### Migration patch ledger

| Surface | Behavior changed | Target test | Port status |
| --- | --- | --- | --- |
| GCF event ingress | Current `GROUP_DELETED` dispatch is explicitly accepted over the older production artifact | Retained event-dispatch test | Dispatch ported; Group deletion behavior remains pending Chunk 7 |

## Migration chunks

### Chunk 1 — Capture baseline and establish parallel layout

**Status: Complete.**

- Confirm persisted production metadata, routes, subscriptions, and property schema.
- Confirm the deployed GCP runtime, exact dependency, source artifact, and build settings.
- Confirm the deployed GAS output, static assets, library version, and checked-in source relationship.
- Record current build and test evidence without overstating it.
- Move unchanged legacy projects under `legacy/` and establish isolated `new/` target source.

**Gate:** Both legacy surfaces remain production-authoritative and independently recoverable.

### Chunk 2 — Create the full-stack Cloudflare skeleton

**Status: Complete.**

- Created minimal root, client, and server package boundaries without template demo behavior.
- Added strict TypeScript, formatting, generated environment and OpenAPI client types, exact dependency pins, and a lockfile.
- Added non-mutating `/events` handling for all thirteen subscriptions, standard JSON API-not-found behavior under `/api/v1/*`, `/openapi.json`, and static asset fallback.
- Added the Lit, Vite, Web Awesome, Bkper design, and web-auth client foundation with deterministic Book, installation, permission, and shell coverage.
- Assigned Vite `5179` and Worker `8797`, updated workspace port forwarding and allocation documentation, and reserved `5180` and `8798` as the next available ports.
- Kept the production menu on GAS and the production webhook on GCP, preserved the unpublished app's `users: '*@brain.uy'` access policy, and pointed development URLs to Cloudflare preview.
- Verified a frozen install and the complete local gate: generated contracts, strict client and server typechecks, 60 client tests, 16 server tests, production client and Worker builds, formatting, and generated-file drift all pass without remote mutation.

**Gate:** The complete local check passes without remote mutation.

### Chunk 3 — Port event ingress and dispatch

**Status: Complete.**

- Added typed event results and explicit no-op handler classes for all event behavior surfaces.
- Reproduced the thirteen-event switch, handler construction, response envelope, error logging, stack-array errors, and unknown-event no-op behavior.
- Preserved request isolation with a new `AppContext` and `Bkper` instance for every delivery.
- Moved authentication to the Platform boundary: target code creates `Bkper` without OAuth, API-key, or agent-id providers and does not consume inbound authentication headers.
- Characterized the accepted `GROUP_DELETED` dispatch to `EventHandlerGroupDeleted` rather than the older deployed routing mistake.
- Verified the complete local gate: generated contracts, strict client and server typechecks, 60 client tests, 34 server tests, production client and Worker builds, formatting, and generated-file drift all pass without remote mutation.

**Gate:** Every subscribed event and unknown-event behavior is characterized deterministically.

### Chunk 4 — Port event orchestration and common boundaries

**Status: Complete.**

- Ported shared event orchestration: required event Book loading, interception order, Portfolio Book selection, one-handler response accumulation, no-op normalization, timing, the established missing-Portfolio response, exchange matching, and Book anchors.
- Ported Portfolio, Base, and Financial Book resolution with the established property, fraction-digit, Collection-order, USD-fallback, currency-alias, and required Financial Book reload behavior.
- Ported exchange-code Account and Group selection, common purchase and sale Account-type predicates, instrument Account selection, realized-date precedence, and historical, fair, and combined calculation-model rules.
- Audited the deployed `bkper-js` 2.18.0 and target 2.42.0 missing-resource behavior. The deployed SDK returned absence for 404 lookups while the target throws `BkperError`; the retained `optionalLookup` helper converts only optional Account and Group 404s to `undefined`, while required Book lookups and all other errors continue to propagate.
- Confirmed target complete-chart caching resolves embedded Account-to-Group, Group-to-Account, and empty-Group relationships without additional network requests.
- Kept every individual event behavior stub non-mutating and left rebuild writes and transaction behavior to their planned chunks.
- Verified the complete local gate: generated contracts, strict client and server typechecks, 60 client tests, 46 server tests, production client and Worker builds, formatting, and generated-file drift all pass without remote mutation.

**Gate:** Common event selection and resolution have no unexplained legacy-to-target difference.

### Chunk 5 — Port posted and checked transaction behavior

**Status: Not started.**

- Port purchase and sale recognition.
- Port fees, interest, and instrument movements.
- Port checked quantity mirroring, automatic resources, pricing properties, remote ids, and rebuild behavior.
- Preserve established no-op, zero, unsupported, duplicate, and Exchange Bot paths.

**Zero-sum gate:** Every posted Financial or Portfolio movement is complete and has the accepted direction.

### Chunk 6 — Port transaction update, uncheck, delete, and restore

**Status: Not started.**

- Port order replacement and mirrored updates.
- Port checked-state and rebuild behavior.
- Port linked Financial, Portfolio, realized, historical, MTM, interest-MTM, and FX cleanup.
- Port trashed lookup and restoration.
- Ensure required async cascades complete before the Worker response.

**Gate:** Amount, direction, state, lookup order, linked cleanup, and responses have no unexplained difference.

### Chunk 7 — Port Account, Group, and Book synchronization

**Status: Not started.**

- Port Account create, update, rename, archive, Group membership, and delete behavior.
- Port Group create, update, rename, properties, hidden state, and delete behavior.
- Preserve the absence of Group hierarchy synchronization.
- Port selected Book property behavior.

**Gate:** Resource synchronization has deterministic event parity and creates no additional movement.

### Chunk 8 — Complete event parity and drift audit

**Status: Not started.**

- Run the complete event matrix.
- Compare every target handler and service with GCP.
- Review dependencies, metadata, generated artifacts, bundle contents, and the patch ledger.

**Gate:** No unexplained event-side difference remains in movement direction, amount, state, lookup order, mutation order, side effects, or responses.

### Chunk 9 — Define the typed menu API contract

**Status: Not started.**

- Define the minimal context, validation, Calculate, Reset, Full Reset, and Forward Date API.
- Define schemas, structured outcomes, errors, permissions, and installation requirements.
- Add thin routes backed by non-mutating service stubs.
- Generate retained OpenAPI client types.

**Gate:** API tests protect the target contract without implementing accounting mutations.

### Chunk 10 — Port view initialization and validation

**Status: Not started.**

- Port Book, Account, and Group context into target client/server responsibilities.
- Port Portfolio Book discovery and instrument Account selection.
- Port uncalculated Account discovery, permissions, pending tasks, locks, closing conditions, and date defaults.
- Adapt preflight placement without changing which operations may begin.

**Gate:** Deterministic fixtures produce the accepted Account scope and operation availability.

### Chunk 11 — Enforce API and client Book permissions

**Status: Not started.**

- Enforce app installation and explicit operation-specific permission allowlists inside API services before mutation.
- Resolve the Portfolio Book and every Financial and Base Book an operation may mutate, then preflight all required permissions before its first write.
- Keep Bkper Core authoritative for every request after the application preflight.
- Enforce Full Reset and lower-forward-date owner and unlocked-Collection requirements at the server boundary.
- Preserve upstream authentication, permission, validation, network, and server failures through structured API errors.
- Gate client initialization and mutation controls without relying on hidden buttons as authorization.
- Keep warnings distinct from blocking permission errors and prevent automatic retries for authorization failures or known accepted mutations.
- Verify denied operations produce no Account, Transaction, Book, or balance mutation in any participating Book.

**Gate:** The deterministic permission matrix and cross-Book no-side-effect assertions pass before accounting mutations are implemented.

### Chunk 12 — Port Calculate

**Status: Not started.**

- Port FIFO ordering, complete and partial lots, short sales, splits, logs, checked state, and model branches.
- Port explicit and inherited rates, realized and historical results, exchange results, MTM, historical MTM, and interest-MTM movements.
- Port support Account lookup, creation, type inference, and Group inference.
- Preserve canonical Portfolio split ids before dependent Financial and Base Book movements are created.
- Preserve the ordered Portfolio, Financial, and Base Book batch phases and per-Account outcomes.

**Zero-sum gate:** Every Calculate result is a complete movement with the accepted amount and direction, and a failed preflight or locked-resource path performs no mutation.

### Chunk 13 — Port Reset and Full Reset

**Status: Not started.**

- Port linked realized, historical, FX, MTM, interest-MTM, split, and forwarded-result cleanup.
- Port checked-state handling, parent restoration, original-state and property restoration, Account dates, and rebuild behavior.
- Port Full Reset forward-state removal and historical-state restoration.
- Preserve mutation phases across Portfolio, Financial, and Base Books.

**Gate:** Reset and Full Reset leave no unintended active movement, retain accepted forward-state differences, and perform no mutation when preflight or lock requirements fail.

### Chunk 14 — Port Forward Date and lower-date repair

**Status: Not started.**

- Port Forward Date validation, balances, forward logs, liquidation bridges, forwarded results, and Account state.
- Port optional Portfolio Book closing-date updates after all required movements and checks complete.
- Port lower-forward-date reset, previous-state repair, cleanup, and re-forward behavior.
- Preserve owner, unlocked-Collection, uncalculated-result, rebuild, and date-order requirements.

**Zero-sum gate:** Forward Date and lower-date repair preserve complete movements, accepted relationships, and lifecycle state in every participating Book.

### Chunk 15 — Port and modernize the menu client

**Status: Not started.**

- Replace GAS templates and `google.script.run` with Lit and the authenticated generated API client.
- Implement Calculate, Reset, Full Reset, and Forward Date workflows.
- Preserve selected resources, inputs, operation intent, progress, and accounting results.
- Deliver explicit validation, permission, warning, error, and completed-mutation states.
- Adopt a responsive, accessible, theme-aware, production-quality Bkper UI.
- Complete browser verification.

**Gate:** The client behavior matrix passes and the target UI is accepted for production use.

### Chunk 16 — Full-stack behavior, dependency, and runtime audit

**Status: Not started.**

- Run the complete event, API, operation, and client matrices from a frozen install.
- Compare event code with GCP and menu accounting outcomes with GAS.
- Review every SDK, async, API, security, performance, workflow, and UI difference.
- Rebuild artifacts reproducibly and reconcile the patch ledger.

**Gate:** Event parity is explained, menu outcome coverage is complete, and target differences are documented.

### Chunk 17 — Preview deployment and routing readiness

**Status: Not started.**

- Build the preview candidate from a clean frozen install.
- Deploy to preview without changing production routing.
- Temporarily restrict developer access to the migration operator before routing development events to preview.
- Route development menu and events independently to preview.
- Confirm authentication, assets, OpenAPI, API protection, event ingress, and logs.

**Gate:** Both preview surfaces work while production remains on GCP and GAS, and only controlled developer activity can reach preview event handling.

### Chunk 18 — Preview event validation

**Status: Not started.**

- Exercise order splitting, fees, interest, quantity mirroring, lifecycle handlers, and resource synchronization on isolated synthetic Books.
- Exercise missing, zero, duplicate, unsupported, and loop-prevention paths.
- Verify canonical resources, relationships, state, direction, amount, and exact per-Book zero sum.

**Gate:** No duplicate, missing, reversed, partial, or imbalanced posted movement is found.

### Chunk 19 — Preview menu and operation validation

**Status: Not started.**

- Exercise context, permissions, validation, and final client interactions.
- Exercise long, partial, and short FIFO scenarios across all calculation models.
- Exercise realized, FX, MTM, Reset, Full Reset, regular Forward Date, and lower-date repair.
- Exercise locked, closed, missing-rate, and denied-permission paths.
- Verify canonical lifecycle state, relationships, direction, amounts, and exact per-Book zero sum.

**Gate:** The target workflows and accounting outcomes are accepted with documented API and UI differences.

### Chunk 20 — Final drift audit and production deployment

**Status: Not started.**

- Repeat GCP and GAS source and deployed-artifact drift audits.
- Reconcile the patch ledger.
- Build from a clean frozen install and pass the complete gate.
- Deploy the accepted Worker to production while both production routes remain on GCP and GAS.
- Confirm deployment, assets, API protection, OpenAPI, and logs.

**Gate:** Deployment changes runtime availability only.

### Chunk 21 — Production webhook cutover and event stabilization

**Status: Not started.**

- Change only the production webhook route to Cloudflare.
- Keep the production menu on GAS and GCP available for event rollback.
- Monitor requests, responses, authentication, dependencies, runtime, and customer-impact reports.
- Use deterministic and preview evidence for accounting correctness; HTTP success alone is not movement proof.

**Rollback triggers:** suspected zero-sum or data-loss issues, reversed or partial movements, duplicate processing, missing linked cleanup, sustained authentication failures, material error or runtime growth, or missing production behavior.

### Chunk 22 — Production menu cutover and full-stack stabilization

**Status: Not started.**

- Change only the production menu route to Cloudflare.
- Keep Cloudflare authoritative for events and GAS available for menu rollback.
- Confirm authenticated context and operation availability.
- Monitor API results, client failures, runtime, authentication, and customer-impact reports.
- Do not initiate customer Book writes solely for monitoring.

**Rollback triggers:** suspected zero-sum or data-loss issues, incorrect quantities or monetary movements, failed lifecycle restoration, incomplete forward operations, sustained authentication or API failures, unacceptable runtime, material errors, or unusable customer workflow.

### Chunk 23 — Repository consolidation and deferred legacy retirement

**Status: Not started.**

- Move the accepted Cloudflare project from `new/` to the Portfolio Bot root.
- Remove inactive legacy working-tree source and obsolete local GCP and GAS tooling.
- Update workspace instructions and ports.
- Restore normal team-wide developer access after controlled migration routing is complete.
- Verify source, tests, lockfile, configuration, generated contracts, assets, and Worker bundle through the move.
- Preserve legacy source in Git history and deployed runtimes as routing rollback targets.

**Gate:** Cloudflare is the only active implementation in the project root and consolidation changes no remote state or application behavior.

## Rollback strategy

### Event rollback

The retained GCP function can receive production events again through a configuration-only webhook change.

1. Stop and identify the trigger.
2. Restore the retained GCP webhook in app metadata.
3. Review the exact configuration diff and remote sync command.
4. Obtain explicit approval before syncing.
5. Confirm persisted routing and inspect event handling.
6. Keep Cloudflare deployed for incident analysis.
7. Reconcile affected linked movements if an event lifecycle may have stopped partway.

### Menu rollback

The retained GAS deployment can serve the production menu again through a configuration-only menu URL change.

1. Stop and identify the trigger.
2. Restore the retained GAS menu URL in app metadata.
3. Review the exact configuration diff and remote sync command.
4. Obtain explicit approval before syncing.
5. Confirm persisted routing and menu access.
6. Keep Cloudflare deployed for incident analysis.
7. Reconcile any operation whose accepted mutation outcome was unclear before retrying it.

After repository consolidation, rebuilding either legacy deployment requires recovering its source from Git history and a separate reviewed incident plan.

## Completion definition

### Event migration complete

- Cloudflare handles production Portfolio Bot events.
- Subscribed behavior has deterministic event-parity coverage.
- Movement direction, amount, state, relationships, lifecycle, and zero-sum checks pass.
- Preview, cutover, and event stabilization gates pass.

### Full-stack migration complete

- Cloudflare serves the production Portfolio Bot client and authenticated API.
- Calculate, Reset, Full Reset, and Forward Date retain deterministic accounting safeguards.
- Accepted API, runtime, workflow, and UI differences are documented instead of mislabeled as full parity.
- Client visual and interactive verification passes.
- Preview, menu cutover, and full-stack stabilization gates pass.
- The Cloudflare application occupies the Portfolio Bot root.
- GCP and GAS remain available as independent routing rollback targets.

### Legacy infrastructure retirement deferred

Deleting the retained GCP function, GAS project or deployment, source artifacts, IAM bindings, properties, credentials, or related infrastructure requires a future plan and explicit approval. Time elapsed alone is not a retirement criterion.

## Optional post-migration work

Any intentional domain change, FIFO correction, lifecycle resilience redesign, atomicity improvement, response hardening, API evolution, further client redesign, shared-service extraction, dependency modernization, or legacy infrastructure retirement remains separate from migration completion.

Inherited issues discovered during migration are recorded separately and addressed after stabilization with their own tests, preview evidence, rollout, and approval.
