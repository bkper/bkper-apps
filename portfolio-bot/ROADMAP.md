# Portfolio Bot: GCP and Apps Script to Cloudflare Migration Roadmap

## Status

**Chunks 1–12 complete — Chunk 13 in progress (Subchunk 1 complete).**

The production baseline is recorded, the event-routing drift has been explicitly resolved in favor of the current `EventHandlerGroupDeleted` behavior, the unchanged legacy projects are isolated under `legacy/`, and the full-stack Cloudflare skeleton, deterministic event dispatcher, shared event orchestration, common resolution boundaries, posted order processing, checked quantity mirroring, transaction lifecycle behavior, resource synchronization, and typed menu API contract are established under `new/`. The Chunk 8 event matrix is complete with no unexplained event-side difference; the target SDK's Account–Group resolution, retry policy, and structured error behavior remain accepted. The target API exposes one read-only pending-calculation Account query and four Account-level operation routes with shared `200 OK` `{ message: string }` success responses. Chunk 10 has ported the legacy pending-calculation Account query, Book, Account, and Group context, authoritative Portfolio Book default date, structured Portfolio Book failures, originating and Portfolio Book view and installation checks, stale-state reset, Financial Book edit availability, and Full Reset view availability. Chunk 11 protects the pending-calculation API, resolves every mutation stub's Portfolio, Financial, and Base Book context, preflights edit permission and Portfolio Bot installation across that context, and enforces the Full Reset owner and unlocked-Collection boundary. Chunk 12 has completed regular and Full Reset parity, the shared operation-response contract, and both Reset operation routes with preflight and lock-failure translation. Reset and Full Reset now precede Calculate in Chunks 12 and 13 because the legacy Calculate rebuild branch invokes regular Reset and returns. Lower-forward-date validation remains with the Forward Date behavior port in Chunk 14, while mutation-control and retry UX remains with the operation client in Chunk 15. Dependency advisories were triaged as unreachable tooling-only findings, so no override or dependency churn was introduced. Production routing remains unchanged.

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
- During Reset, Calculate, and Forward parity ports, keep legacy processors and accounting services free of API response construction. Preserve their return behavior except for unavoidable asynchronous `Promise` adaptation.
- Keep parity migration and target-server integration in separate subchunks. Parity subchunks leave API facades, response schemas, routes, generated contracts, and non-mutating operation stubs unchanged; only a dedicated subsequent integration subchunk may apply the accepted API contract and wire the migrated behavior.
- Successful Calculate, Reset, Full Reset, and Forward Date requests return `200 OK` with the shared `{ message: string }` response. The message carries operation commentary for the UI, not a resource receipt. Do not add mutation receipts or response tracking to the accounting implementations without a concrete consumer requirement; errors retain the structured API error envelope.
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

The route names, request payloads, operation grouping, and preflight placement were established in the typed API chunk.

The contract remains small: context and validation required by the client plus Calculate, Reset, Full Reset, and Forward Date. It must preserve safe operation ordering without carrying `google.script.run` implementation details into the public API. Parity implementations do not collect or reshape data solely for an API response.

### Mutating-operation responses

Successful Calculate, Reset, Full Reset, and Forward Date requests return `200 OK` with one shared `{ message: string }` response. The message preserves operation commentary required by the UI without tracking changed resources or producing a mutation receipt. Bkper remains the authoritative resource and audit source.

Validation, authorization, installation, lock, and domain failures retain the structured API error envelope. An unexpected failure after mutation begins remains an uncertain outcome and must not be presented as safely retryable. Additional operation-specific response data requires a concrete consumer.

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
- Edit permissions, Full Reset eligibility, locks, closing dates, and installation produce explicit target states during context loading; pending tasks produce an explicit action-time state before an operation batch starts.
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
| GCF event ingress | Current `GROUP_DELETED` dispatch is explicitly accepted over the older production artifact | Retained event-dispatch and missing-Group behavior tests | Dispatch and Group deletion behavior ported |

### Accepted target-runtime differences

These differences are deliberate consequences of moving from the deployed `bkper-js` 2.18.0 runtime to the target `bkper-js` 2.42.0 Platform runtime. They are accepted runtime behavior, not silent Portfolio Bot domain changes.

| Boundary | Deployed 2.18.0 behavior | Target 2.42.0 behavior | Migration decision |
| --- | --- | --- | --- |
| Account–Group resolution | `Account.getGroups()` performs an Account-specific Group request | `Account.getGroups()` loads and reuses the Book Group cache, then resolves the Account's embedded Group ids against that cache | Accept the current SDK lifecycle; do not load complete Books upfront or add Portfolio Bot lookup workarounds |
| Request retries | The SDK retries broadly for non-400 and non-404 responses, including conflicts, with up to four retries after the initial request | The SDK retries only authentication, transient, rate-limit, server, and network failures, with at most three retries; conflicts such as `409` fail immediately | Accept the narrower modern retry policy; do not reproduce legacy conflict retries in Portfolio Bot |
| API errors | API failures commonly propagate as plain strings | API failures propagate as structured `BkperError` values; event ingress records stack lines when available and logs retain richer diagnostics | Accept the structured error and response-presentation difference; it does not itself add a mutation, retry, or movement |

### Deferred inherited behavior ledger

| Surface | Inherited behavior | Migration treatment | Deferred status |
| --- | --- | --- | --- |
| GCF transaction lifecycle | Event cleanup does not query or delete linked `interestmtm_` movements even though the GAS Reset implementation recognizes them | Preserve the exact legacy event cleanup set and assert that `interestmtm_` remains absent | Any intentional correction remains separate post-migration work |

### Chunk 8 event parity audit

Paths in the matrices below are relative to `portfolio-bot/`. Legacy event files are under `legacy/gcf/src/`, target event files are under `new/server/src/events/`, and deterministic tests are under `new/server/test/`.

#### Subscribed-event matrix

| Subscribed event | Safety-relevant behavior | Legacy implementation | Target implementation | Deterministic evidence | Classification |
| --- | --- | --- | --- | --- | --- |
| `TRANSACTION_POSTED` | Recognize eligible orders; split fees, interest, and instrument movements with established amounts, directions, properties, dates, and remote ids; preserve no-ops and zero-quantity failure | `index.ts`; `EventHandlerTransactionPosted.ts`; `InterceptorOrderProcessor.ts` | `routes.ts`; `handlers/EventHandlerTransactionPosted.ts`; `interceptors/InterceptorOrderProcessor.ts` | `events/events.test.ts` routing; `events/interceptors/InterceptorOrderProcessor.test.ts` purchase, sale, combined model, zero, unsupported, unposted, and loop-prevention cases | **Parity** |
| `TRANSACTION_CHECKED` | Mirror one quantity movement in the Portfolio Book, preserve `Buy >> instrument` and `instrument >> Sell`, avoid duplicates, and flag rebuild when required | `EventHandlerTransactionChecked.ts`; `EventHandlerTransaction.ts`; `InterceptorFlagRebuild.ts` | `handlers/EventHandlerTransactionChecked.ts`; `handlers/EventHandlerTransaction.ts`; `interceptors/InterceptorFlagRebuild.ts` | `events/handlers/EventHandlerTransactionChecked.test.ts` | **Parity** for movement behavior; **accepted runtime difference** for awaited rebuild completion and replay recovery after a previously abandoned update |
| `TRANSACTION_UNCHECKED` | Flag an externally changed Portfolio instrument for rebuild; skip Portfolio Bot changes | `EventHandlerTransactionUnchecked.ts`; `InterceptorFlagRebuild.ts` | `handlers/EventHandlerTransactionUnchecked.ts`; `interceptors/InterceptorFlagRebuild.ts` | `events/handlers/EventHandlerTransactionUnchecked.test.ts`; rebuild cases in `EventHandlerTransactionChecked.test.ts` | **Parity**; **accepted runtime difference** for awaiting the required update before Worker completion |
| `TRANSACTION_UPDATED` | Delete before replacing materially changed orders; skip cleanup for absent, empty, or description-only previous attributes; update complete mirrored movements; preserve unposted, zero-quantity, not-found, checked, and retry paths | `EventHandlerTransactionUpdated.ts`; `InterceptorOrderProcessorDeleteFinancial.ts`; `InterceptorOrderProcessor.ts` | `handlers/EventHandlerTransactionUpdated.ts`; `interceptors/InterceptorOrderProcessorDeleteFinancial.ts`; `interceptors/InterceptorOrderProcessor.ts` | `events/handlers/EventHandlerTransactionUpdated.test.ts`; order and cleanup interceptor tests | **Parity**; **accepted runtime difference** for awaited cleanup and uncheck completion |
| `TRANSACTION_DELETED` | Select Financial or Portfolio deletion; remove split and mirrored movements; flag rebuild; delete the exact linked realized, MTM, FX, historical, historical-MTM, and historical-FX set | `EventHandlerTransactionDeleted.ts`; all three `InterceptorOrderProcessorDelete*.ts` files | `handlers/EventHandlerTransactionDeleted.ts`; all three `interceptors/InterceptorOrderProcessorDelete*.ts` files | `events/handlers/EventHandlerTransactionDeleted.test.ts`; both `events/interceptors/InterceptorOrderProcessorDelete*.test.ts` files | **Parity**; **accepted runtime difference** for awaited sibling completion and optional Base-Book adaptation; **inherited legacy behavior** for the omitted `interestmtm_` prefix |
| `TRANSACTION_RESTORED` | Re-run recognized order processing, find only the trashed remote-id mirror, restore it, and preserve missing or unmatched no-ops | `EventHandlerTransactionRestored.ts`; `InterceptorOrderProcessor.ts`; `EventHandlerTransaction.ts` | `handlers/EventHandlerTransactionRestored.ts`; `interceptors/InterceptorOrderProcessor.ts`; `handlers/EventHandlerTransaction.ts` | `events/handlers/EventHandlerTransactionRestored.test.ts`; posted-order interceptor tests | **Parity** |
| `ACCOUNT_CREATED` | Match exchange eligibility, create the Portfolio Account, create eligible flat Groups, copy synchronized fields, and add no movements | `EventHandlerAccount.ts`; `EventHandlerAccountCreatedOrUpdated.ts` | `handlers/EventHandlerAccount.ts`; `handlers/EventHandlerAccountCreatedOrUpdated.ts` | routing in `events/events.test.ts`; `events/handlers/EventHandlerAccountCreatedOrUpdated.test.ts` | **Parity** with the accepted Account–Group SDK cache lifecycle |
| `ACCOUNT_UPDATED` | Resolve current name before previous name, replace synchronized fields and Group membership, rename/archive as established, and add no movements | Same Account handlers as `ACCOUNT_CREATED` | Same target Account handlers as `ACCOUNT_CREATED` | routing in `events/events.test.ts`; both Account create/update synchronization cases | **Parity** with the accepted Account–Group SDK cache lifecycle |
| `ACCOUNT_DELETED` | Match exchange eligibility; return the legacy missing-Account response; archive Accounts with posted movements and remove Accounts without them | `EventHandlerAccount.ts`; `EventHandlerAccountDeleted.ts` | `handlers/EventHandlerAccount.ts`; `handlers/EventHandlerAccountDeleted.ts` | `events/handlers/EventHandlerAccount.test.ts`; `events/handlers/EventHandlerAccountDeleted.test.ts` | **Parity** |
| `GROUP_CREATED` | Match exchange eligibility and create a flat Portfolio Group with visible properties and hidden state only | `EventHandlerGroup.ts`; `EventHandlerGroupCreatedOrUpdated.ts` | `handlers/EventHandlerGroup.ts`; `handlers/EventHandlerGroupCreatedOrUpdated.ts` | routing in `events/events.test.ts`; `events/handlers/EventHandlerGroupCreatedOrUpdated.test.ts` | **Parity** |
| `GROUP_UPDATED` | Resolve current name before previous name and replace synchronized flat Group fields without hierarchy propagation | Same Group handlers as `GROUP_CREATED` | Same target Group handlers as `GROUP_CREATED` | `events/handlers/EventHandlerGroup.test.ts`; Group create/update synchronization test | **Parity** |
| `GROUP_DELETED` | Remove the matching Portfolio Group or return the accepted missing-Group response | Current `index.ts`; `EventHandlerGroupDeleted.ts` | `routes.ts`; `handlers/EventHandlerGroupDeleted.ts` | routing in `events/events.test.ts`; `events/handlers/EventHandlerGroupDeleted.test.ts` | **Accepted runtime difference** from the older deployed routing artifact; target matches the explicitly accepted current-source baseline |
| `BOOK_UPDATED` | Propagate the historical flag to the Base Book, clear competing Portfolio Book flags, preserve launch order, and add no movements | `EventHandlerBookUpdated.ts` | `handlers/EventHandlerBookUpdated.ts` | `events/handlers/EventHandlerBookUpdated.test.ts` | **Parity**; **accepted runtime difference** for waiting on every launched update before return or failure |

#### Cross-event safety matrix

| Safety-relevant behavior | Legacy implementation | Target implementation | Deterministic evidence | Classification |
| --- | --- | --- | --- | --- |
| All thirteen subscriptions, unknown-event no-op, response envelope, and one context per delivery | `index.ts`; `AppContext.ts` | `routes.ts`; `shared/app-context.ts` | `events/events.test.ts` | **Parity** for routing and normalization; **accepted runtime difference** for Platform authentication and structured `BkperError` presentation |
| Portfolio, Financial, and Base Book selection; exchange aliases; first-match order; Account, Group, model, and realized-date selection | `BotService.ts`; `EventHandler.ts`; Account, Group, and Transaction base handlers | `services/BotService.ts`; `handlers/EventHandler.ts`; corresponding target base handlers | `events/services/BotService.test.ts`; `events/handlers/EventHandler.test.ts`; Account and Group selection tests | **Parity** |
| Account–Group relationship resolution from embedded ids | SDK 2.18 Account-specific Group lookup | SDK 2.42 Book Group cache used by target handlers and services | `shared/bkper-js-compatibility.test.ts` complete-chart case | **Accepted runtime difference**; no eager complete-Book load or lookup workaround |
| Optional 404 resources versus required failures | SDK 2.18 returned absence for optional resource lookup | `shared/optional-lookup.ts` converts only Account, Group, and explicitly optional Transaction 404s | `shared/bkper-js-compatibility.test.ts`; missing temporary remote-id deletion case | **Accepted runtime difference** |
| Retry classification, especially HTTP `409` | SDK 2.18 retried broadly | SDK 2.42 fails `409` immediately and limits retryable authentication, transient, rate-limit, server, and network failures | `shared/bkper-js-compatibility.test.ts` immediate-409 case | **Accepted runtime difference** |
| Every created movement has one nonzero amount, one origin, one destination, established direction, and canonical remote ids | `InterceptorOrderProcessor.ts`; `EventHandlerTransactionChecked.ts` | Corresponding target interceptor and checked handler | posted-order and checked-mirroring tests assert complete movements, directions, properties, and remote ids | **Parity**; no unexplained zero-sum risk found |
| Combined-model historical sale amount and rates | `InterceptorOrderProcessor.getSalePriceHist()` and sale posting path | Same target methods and branch order | `events/interceptors/InterceptorOrderProcessor.test.ts` combined-model historical sale case | **Parity** |
| Update cleanup-before-replacement and failure ordering | `EventHandlerTransactionUpdated.ts` | `handlers/EventHandlerTransactionUpdated.ts` | `events/handlers/EventHandlerTransactionUpdated.test.ts` no-op, replacement, cleanup failure, unposted, zero, and missing-mirror cases | **Parity**; **accepted runtime difference** for awaited completion |
| Financial deletion of fees, interest, instrument split, Portfolio mirror, and linked result set | `InterceptorOrderProcessorDeleteFinancial.ts`; `InterceptorOrderProcessorDelete.ts` | Corresponding target interceptors | `events/interceptors/InterceptorOrderProcessorDeleteFinancial.test.ts` exact cleanup, sibling failure, no-Base, missing-resource, and temporary-id cases | **Parity**; `interestmtm_` omission is **inherited legacy behavior** |
| Portfolio deletion chooses the credit permanent Account first, then debit permanent Account; unposted or non-permanent paths no-op | `InterceptorOrderProcessorDeleteInstruments.ts` | Corresponding target interceptor | `events/interceptors/InterceptorOrderProcessorDeleteInstruments.test.ts` sale, purchase, and no-op cases | **Parity** |
| Portfolio deletion with no matching Financial exchange still returns its deletion response without linked cleanup | `InterceptorOrderProcessorDeleteInstruments.ts` | Corresponding target interceptor | unmatched-exchange case in `InterceptorOrderProcessorDeleteInstruments.test.ts` | **Inherited legacy behavior**; no production change |
| Linked restoration untrashes only the matching Portfolio mirror; missing and unmatched paths do not restore a movement | `EventHandlerTransactionRestored.ts` | `handlers/EventHandlerTransactionRestored.ts` | `events/handlers/EventHandlerTransactionRestored.test.ts` | **Parity** |
| Account and Group missing-resource deletion responses and unmatched-exchange no-ops | Account and Group base/deletion handlers | Corresponding target handlers | `EventHandlerAccountDeleted.test.ts`; `EventHandlerGroupDeleted.test.ts`; Account and Group selection tests | **Parity** |
| Required asynchronous mutations finish before the Worker response; sibling cleanup settles before failure propagation | Legacy launched several updates and cascades without awaiting them | Target checked, update, deletion, rebuild, and Book handlers await the already-required work while retaining launch and mutation order | checked, update, both deletion-interceptor, and Book-update timing/failure tests | **Accepted runtime difference** required by the target request lifecycle |
| Lifecycle lookup order checks the remote-id candidate before exchange matching | `EventHandlerTransaction.processObject()` | Same target method | unmatched restoration case in `EventHandlerTransactionRestored.test.ts` | **Incorrect test assumption** found during the audit: the first draft expected no lookup; the test was corrected and production was unchanged |
| Exchange Bot and Portfolio Bot loop prevention | `InterceptorOrderProcessor.ts`; `InterceptorFlagRebuild.ts` | Corresponding target interceptors | posted-order no-op and checked rebuild loop-prevention cases | **Parity** |

#### Audit result

- All thirteen subscribed events map to the current legacy source and deterministic target evidence.
- Eight high-value deterministic tests were added, and the existing update-order test was expanded, covering combined historical sales, update ordering and no-ops, exact deletion no-ops, permanent-Account selection, unmatched exchanges, linked restoration, missing Account deletion, and immediate HTTP `409` failure.
- The exact event cleanup prefixes remain `''`, `mtm_`, `fx_`, and, for the combined model, `hist_`, `mtm_hist_`, and `fx_hist_`. `interestmtm_` remains intentionally absent as inherited legacy behavior.
- One incorrect audit-test assumption was corrected: unmatched lifecycle handling still performs the established remote-id lookup before exchange matching.
- No actual migration drift was confirmed, no event production code changed, and no unexplained difference remains in movement amount, direction, state, lookup order, mutation order, cleanup side effects, or responses.

#### Dependency advisory triage

The frozen dependency audit reports eight advisories across four affected tooling packages. No affected package version is a runtime dependency of the deployed client or Worker, and no advisory's required vulnerable operation is used by the migration target. The package manifest and lockfile therefore remain unchanged; forced overrides and pre-release upgrades would add maintenance risk without reducing deployed exposure.

| Advisory | Installed path | Required vulnerable operation | Portfolio Bot exposure | Decision |
| --- | --- | --- | --- | --- |
| Five `undici` advisories: `GHSA-8xcm-r25x-g524`, `GHSA-4cwx-7wf7-3272`, `GHSA-m8rv-5g2x-5cg5`, `GHSA-jr45-8vmc-qm54`, `GHSA-v3r7-h72x-cjcm` | `miniflare` uses affected `undici` 7.28.0; the separate `bkper` path resolves safe 8.9.0 | Retry or shared-cache interceptors, non-`fetch` blob-like dispatch, or untrusted cookie attributes | Miniflare is only the local Worker simulator, the target does not invoke those APIs, and it is absent from deployed bundles | Accept until a stable Miniflare release uses `undici` 7.29.0 or later; do not force an override or adopt the alpha-only major release |
| `nanoid` `GHSA-2v37-7h3g-55p8` | Vite build tooling through PostCSS uses affected 3.3.17; Web Awesome separately resolves safe 5.1.16 | A custom generator called with attacker-controlled size `0` | PostCSS calls the standard non-secure generator with constant size `6`; it is build-only and absent from deployed bundles | Accept until the transitive lock resolves 3.3.18 or later; do not add an unused direct dependency or override |
| `esbuild` `GHSA-g7r4-m6w7-qqqr` | `bkper` and Vite build tooling use affected 0.27.7 | The esbuild development server serving files on Windows | Bkper uses esbuild build/watch APIs, while Vite and Miniflare provide the local servers; esbuild's server API is not used and esbuild is absent from deployed bundles | Accept until the pinned toolchain supports 0.28.1 or later; do not force an incompatible range |
| `js-yaml` `GHSA-5p4m-2wfm-xmqj` | `openapi-typescript` through Redocly uses affected 4.3.0 | Parsing attacker-influenced YAML containing a large `!!omap` | The local generator passes an in-memory OpenAPI object produced by the target server; it does not parse external YAML, and `js-yaml` is absent from deployed bundles | Accept until the transitive parent refreshes naturally; do not add an override |

`bun audit` is expected to remain nonzero while these accepted transitive versions remain in the frozen lockfile. Re-triage is required if an affected package enters runtime code, an affected operation is introduced, development exposure changes, or a normal parent dependency update makes a compatible fix available.

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
- Audited the deployed `bkper-js` 2.18.0 and target 2.42.0 missing-resource behavior. The deployed SDK returned absence for 404 lookups while the target throws `BkperError`; the retained `optionalLookup` helper converts only explicitly optional resource 404s to `undefined`; this chunk applies it to Account and Group boundaries, while required Book lookups and all other errors continue to propagate.
- Confirmed target complete-chart caching resolves embedded Account-to-Group, Group-to-Account, and empty-Group relationships without additional network requests.
- Kept every individual event behavior stub non-mutating and left rebuild writes and transaction behavior to their planned chunks.
- Verified the complete local gate: generated contracts, strict client and server typechecks, 60 client tests, 46 server tests, production client and Worker builds, formatting, and generated-file drift all pass without remote mutation.

**Gate:** Common event selection and resolution have no unexplained legacy-to-target difference.

### Chunk 5 — Port posted and checked transaction behavior

**Status: Complete.**

- Ported purchase and sale recognition with the established fee, interest, and instrument movements, calculation-model properties, response order, concurrency, automatic Accounts, and remote ids.
- Ported checked quantity mirroring with Portfolio Account and Group creation, `Buy` and `Sell` support Accounts, pricing and original-value properties, exchange matching, and duplicate lookup.
- Preserved established unposted, missing, zero, unsupported, duplicate, Exchange Bot, Portfolio Bot loop-prevention, and rebuild paths.
- Adapted optional Account and Group 404 lookups to target SDK behavior while continuing to propagate required and non-404 failures.
- Awaited rebuild Account updates that were unawaited in the legacy runtime so required Cloudflare work completes before the response.
- Made existing-mirror replay resume a missing rebuild flag before returning `FOUND`, allowing an awaited update failure to recover without creating a duplicate movement.
- Verified the complete local gate: generated contracts, strict client and server typechecks, 60 client tests, 58 server tests, production client and Worker builds, formatting, and generated-file drift all pass without remote mutation.

**Zero-sum gate:** Every posted Financial or Portfolio movement is complete and has the accepted direction.

### Chunk 6 — Port transaction update, uncheck, delete, and restore

**Status: Complete.**

- Ported order replacement, mirrored updates, description-only behavior, update retry, checked-state handling, and rebuild flags.
- Ported Financial and Portfolio deletion paths, gain/loss rebuild handling, and the exact legacy realized, MTM, FX, historical, historical-MTM, and historical-FX cleanup set.
- Adapted optional Transaction 404 lookups to target SDK behavior so temporary `crrp_id_*` remote ids remain skippable while required and non-404 failures still propagate.
- Adapted linked cleanup for the optional Base Book: absent Base and USD fallback Books skip only inapplicable FX lookups, while configured Base Books retain the established lookup and mutation launch order.
- Preserved the inherited absence of `interestmtm_` event cleanup without silently changing business logic and recorded it for separate post-migration work.
- Ported trashed lookup and restoration with the established queries and responses.
- Awaited previously unawaited mirror unchecks and linked cleanup cascades so required Cloudflare work completes before the response while retaining the established lookup and mutation launch order.
- Waited for every concurrently launched linked cleanup to settle before propagating a failure, preventing the Worker response from abandoning sibling deletion work.
- Verified the complete local gate: generated contracts, strict client and server typechecks, 60 client tests, 69 server tests, production client and Worker builds, formatting, and generated-file drift all pass without remote mutation.

**Gate:** Amount, direction, state, lookup order, linked cleanup, and responses have no unexplained difference.

### Chunk 7 — Port Account, Group, and Book synchronization

**Status: Complete.**

- Ported Account exchange eligibility, current-name and previous-name lookup, create, update, rename, archive, Group membership replacement, and delete behavior.
- Ported Group exchange eligibility, current-name and previous-name lookup, create, update, rename, visible properties, hidden state, and delete behavior, including the accepted missing-Group response.
- Preserved flat Group synchronization without parent or child hierarchy propagation.
- Ported Portfolio historical-property propagation and competing `stock_book` property cleanup.
- Adapted optional Account and Group 404 lookups to target SDK behavior while propagating non-404 failures.
- Awaited all launched Book updates before returning or propagating the first failure while preserving mutation launch order.
- Verified the complete local gate: generated contracts, strict client and server typechecks, 60 client tests, 79 server tests, production client and Worker builds, formatting, and generated-file drift all pass without remote mutation.

**Gate:** Resource synchronization has deterministic event parity and creates no additional movement.

### Chunk 8 — Complete event parity and drift audit

**Status: Complete.**

- Completed the explicit subscribed-event and cross-event safety matrices.
- Added focused deterministic coverage for the audit's high-value missing paths without changing event production behavior.
- Classified every observed difference as accepted target-runtime behavior, inherited legacy behavior, or an incorrect test assumption; no actual migration drift was confirmed.
- Handler and service comparison found no unexplained movement amount, direction, state, lookup order, mutation order, cleanup side effect, or response difference.
- Metadata, generated artifacts, bundle contents, and the patch ledger have been reviewed.
- Triaged all eight dependency advisories as unreachable tooling-only findings and retained the frozen package manifest and lockfile without overrides or pre-release upgrades.
- Verified the complete local gate: generated contracts, strict client and server typechecks, 60 client tests, 87 server tests, production client and Worker builds, formatting, and generated-file drift all pass without remote mutation.

**Gate:** Pass — no unexplained event-side difference remains, and dependency advisories have explicit exposure and re-triage decisions.

### Chunk 9 — Define the typed menu API contract

**Status: Complete.**

- Defined one read-only Portfolio Book route that returns the Account ids pending calculation as `{ ids: string[] }` and four explicit Account-level operation routes for Calculate, Reset, Full Reset, and Forward Date.
- Kept Account and Group menu selection, Portfolio Book discovery, and preliminary client validation on direct authenticated Bkper reads rather than duplicating the Core API.
- Required explicit Calculate date and MTM intent, a Forward date, and no body for Reset or Full Reset.
- Retained the shared message-only error envelope with standard HTTP status categories.
- Defined installation on every Book an operation may mutate, edit permission on each mutation target, and additional Portfolio Book owner and unlocked-Collection requirements for Full Reset and lower-forward-date repair; enforcement remains in the planned permission chunk.
- Added thin routes backed by non-mutating service stubs and generated retained OpenAPI client types.
- Verified the complete local gate: generated contracts, strict client and server typechecks, 60 client tests, 92 server tests, production client and Worker builds, formatting, and generated-file drift all pass without remote mutation.

**Gate:** Pass — API tests protect the target contract without implementing accounting mutations.

### Chunk 10 — Port view initialization and validation

**Status: Complete.**

- Ported the existing read-only pending-calculation Account query from the legacy `BotService.getUncalculatedAccounts`, `BotService.getUncalculatedAccountsQuery`, and `ValidationAccount` behavior.
- Preserved Base Book selection, permanent Account chart order, unchecked purchase and sale handling, rebuild flags, missing exchange-rate rules, closing-date query behavior, and complete Transaction pagination without introducing mutations.
- Ported legacy Portfolio Book discovery in Collection order, including the `stock_book` property and zero-fraction fallback.
- Ported URL-selected Account and Group context, name-based Portfolio resource mapping, Account-over-Group precedence, permanent and active instrument eligibility, exchange Group requirements, alphabetical sorting, and the no-selection pending-calculation path; unresolved selected or mapped resources produce structured blocking errors instead of falling through to another context.
- Adapted the synchronous GAS chart access to asynchronous `bkper-js` reads by loading the selected and discovered Portfolio Book charts before resolving context.
- Agreed that the Book used to open the menu is only a context anchor for resolving resources from the Portfolio Book. After resolution, the Portfolio Book is authoritative for the default date and timezone; this deliberate target behavior is not a regression from the GAS menu's use of the originating Book timezone.
- Replaced the legacy missing-Portfolio-Book throw with a structured client error and explicit error state while preserving the Reset availability distinction without introducing mutations.
- Added originating and Portfolio Book view-permission and installation checks, and reset stale view state before reinitialization.
- Ported legacy Base and Financial Book resolution into the client context, including Collection order, explicit Base and USD fallback selection, Financial Book fraction-digit and currency matching, and the deprecated `exchange_code` alias where established.
- Ported legacy edit-permission availability for the Financial Books required by the resolved Account scope. Missing Financial Books and permissions below EDITOR remain one blocking availability error while the resolved view context stays visible.
- Ported legacy Full Reset view availability for selected Account and Group scopes: the Portfolio Book must grant OWNER permission, and every Book in the originating Collection must have no effective lock or closing date. Missing dates and the legacy `1900-00-00` sentinel remain unlocked and open; the no-selection pending-calculation scope remains ineligible.
- Confirmed that legacy pending-task validation is action-time workflow behavior rather than view initialization: each click checks the Portfolio Book backlog once before the first Account request. Its migration therefore remains in Chunk 15 with the operation-batch client instead of introducing an unused helper or stale initialization state here.
- Verified the complete local gate with 88 client tests, 100 server tests, strict typechecks, production client and Worker builds, formatting, and generated-file drift checks.

**Gate:** Pass — deterministic fixtures produce the accepted Account scope and operation availability.

### Chunk 11 — Enforce API Book permissions

**Status: Complete.**

- Protected the pending-calculation API with explicit view permission and Portfolio Bot installation checks before its Account query.
- Established and wired shared application-service orchestration that resolves the Portfolio Book, Portfolio Account, Financial Book, and Base Book before every mutation stub.
- Preflighted explicit `EDITOR` or `OWNER` permission and Portfolio Bot installation on every resolved mutation Book, validating a shared Financial and Base Book once.
- Enforced Portfolio Book `OWNER` permission and the accepted Collection-wide open and unlocked requirement for Full Reset, including missing dates and the legacy `1900-00-00` sentinel.
- Kept Bkper Core authoritative after application preflight and retained the structured API error boundary.
- Kept all four operation implementations as non-mutating stubs; deterministic permission and service-wiring tests reject denied requests before later accounting behavior can begin.
- Left lower-forward-date owner and Collection validation with the Forward Date behavior port in Chunk 14, where the requested date can be compared with established Account state.
- Left mutation-control gating, warnings, and non-retry behavior with the operation client in Chunk 15; no mutation controls or operation retry workflow exist yet.
- Verified the complete local gate with 88 client tests, 115 server tests, strict typechecks, production client and Worker builds, formatting, and generated-file drift checks.

**Gate:** Pass — the deterministic API permission matrix and non-mutating operation stubs establish the pre-accounting authorization boundary.

### Chunk 12 — Port Reset and Full Reset

**Status: Complete.**

This chunk is a parity port of the legacy batched `resetRealizedResultsForAccountAsync` behavior used by the Reset and Full Reset menu operations and by Calculate's `needs_rebuild` branch. The target method is named `ResetRealizedResultsService.resetAccount(context, full)`; the class already supplies the realized-result context, the shared operation context carries its Portfolio, Financial, and Base Book resources, and target methods are asynchronous. The separate immediate and sequential `resetRealizedResultsForAccountSync` behavior is used only by lower-forward-date repair; it remains with the Forward Date port in Chunk 14 and must not be deduplicated with the batched implementation during migration.

Reset remains one service with one primary transaction loop and the established `full` branches. The linked-cleanup paths, split and parent restoration, property order, lookup order, checked-state handling, and Account-state updates remain in that service rather than being redistributed into newly designed cleanup utilities, strategies, or pipelines. `ResetRealizedResultsProcessor` remains a separate ordered mutation coordinator.

The agreed target structure preserves those legacy file-level boundaries:

```text
new/server/src/api/services/
├── reset-service.ts
├── bot-service.ts
├── stock-account.ts
└── reset/
    ├── reset-realized-results-processor.ts
    └── reset-realized-results-service.ts
```

`reset-service.ts` remains the thin API and authorization facade, `bot-service.ts` is extended in place, `stock-account.ts` contains the Reset-required Account state behavior and remains reusable by Calculate and Forward Date, and `reset/` is organizational only.

Planned committable subchunks follow the existing legacy file and method boundaries:

1. Establish the agreed structure and port Reset-required constants, `StockAccount` behavior, and existing `BotService` dependencies such as Account query construction and purchase and sale recognition without wiring either Reset route.
2. Port `ResetRealizedResultsProcessor` with its established four Maps, id-based deduplication, locked-Transaction detection, Portfolio update, Portfolio trash, Financial trash, and Base trash phase order, and explicit target-runtime awaiting. Preserve the legacy `void` return boundary as `Promise<void>` and do not add API response tracking.
3. Port regular Reset as one parity unit inside the retained transaction loop: complete paginated loading, source order, `stock-bot` filtering, forward-log and forward-liquidation handling, exact realized, MTM, interest-MTM, FX, and historical linked cleanup, split trashing, parent quantity and property restoration, legacy price fallback, forwarded-price correction, locked-path no-write behavior, ordered batch execution, and the final Portfolio Account state update. Keep the API stubs non-mutating.
4. Extend the same method with the existing Full Reset branches for historical order, date, and quantity restoration and forward-state removal; retain the established regular-versus-full Account-date outcomes and verify the existing owner and open and unlocked Collection boundary. Keep both API stubs non-mutating and do not add response tracking, schema changes, route wiring, or facade integration in this parity subchunk.
5. Apply one shared success-response contract consistently to Calculate, Reset, Full Reset, and Forward Date; remove all unused mutation result schemas and regenerate client types. Keep every mutation operation stub non-mutating and unwired.
6. Wire regular Reset and Full Reset through `reset-service.ts`, retaining the established preflight order and translating legacy operation failures at the facade without adding mutation tracking to the parity implementation.

Subchunk 1 evidence:

- Established `stock-account.ts` and the organizational `reset/` service and processor files.
- Ported only the constants and `StockAccount` state behavior required by batched Reset, including asynchronous Group resolution and Account update delegation for `bkper-js`.
- Extended the existing menu `BotService` with legacy Account query clause order and posted purchase and sale recognition; the query retains regular, Full Reset, forwarded-date, and optional before-date branches.
- Added deterministic supporting-surface parity tests.
- Verified the complete local gate with 95 client tests, 123 server tests, strict typechecks, production client and Worker builds, formatting, and generated-file drift checks.

Subchunk 2 evidence:

- Ported the four legacy Transaction Maps, id-based replacement without insertion-order drift, and locked-Transaction detection in `ResetRealizedResultsProcessor`.
- Preserved and explicitly awaited the established Portfolio update, Portfolio trash, Financial trash, and Base trash phase order, including empty-phase no-ops and failure-before-later-phase behavior.
- Preserved the legacy `void` return boundary as `Promise<void>` and kept API response construction out of the processor.
- Added four deterministic processor parity tests and verified the complete local gate with 95 client tests, 127 server tests, strict typechecks, production client and Worker builds, formatting, and generated-file drift checks.

Subchunk 3 evidence:

- Ported regular Reset in the retained transaction loop with complete cursor pagination, source order, `stock-bot` filtering, forward-log and forward-liquidation handling, and the exact realized, MTM, interest-MTM, FX, historical, and forwarded-result linked queries.
- Used the Financial and Base Books already resolved and preflighted by the target operation boundary; no `bkper-gs` iterator compatibility layer or duplicate Book resolution was introduced. Within that target boundary, the legacy agent branch and explicit linked-cleanup loops remain intact.
- Preserved checked-state clearing, split trashing, parent quantity and property restoration, legacy price fallback, forwarded-price correction, and movement endpoints without creating a Transaction.
- Preserved lock detection across every queued Portfolio, Financial, and Base Book Transaction and returned before any batch or Account write when a lock is found.
- Explicitly awaited the established four processor phases before clearing rebuild state and applying the regular Reset realized-date outcome to the Portfolio Account.
- Ported the legacy `Summary` source and method-return boundary, including its original result type and the retained `resetingAsync()` and `lockError()` outcomes, without adding API response construction.
- Added three deterministic regular Reset parity tests plus shared `Summary` behavior coverage and verified the complete local gate with 95 client tests, 131 server tests, strict typechecks, production client and Worker builds, formatting, and generated-file drift checks.

Subchunk 4 evidence:

- Extended the retained batched Reset loop with the legacy Full Reset branches, restoring historical order, date, and quantity before the established parent-restoration path.
- Removed the historical and forward Transaction properties in the established order and retained the regular linked cleanup, lock detection, movement endpoints, and four ordered processor phases.
- Preserved the Full Reset Account outcome by clearing rebuild, realized-date, forwarded-date, forwarded-rate, and forwarded-price state only after the lock gate and successful batch phases.
- Retained the existing Portfolio Book owner and open and unlocked Collection preflight coverage.
- Added one deterministic Full Reset parity test and verified the complete local gate with 95 client tests, 132 server tests, strict typechecks, production client and Worker builds, formatting, and generated-file drift checks.

Subchunk 5 evidence:

- Initially applied `204 No Content` to all four mutation routes and retained their structured error responses; the contract was subsequently changed to shared `200 OK` `{ message: string }` responses so the UI can display operation commentary.
- Removed the unused mutation result schemas and resource-receipt types from the server contract and regenerated the client OpenAPI types without them.
- Added deterministic API and OpenAPI coverage; 95 client tests, 132 server tests, strict typechecks, production client and Worker builds, and formatting pass, and regenerated client types remain stable across repeated generation.

Subchunk 6 evidence:

- Wired regular Reset and Full Reset through the thin `reset-service.ts` facade using the resolved Portfolio, Financial, and Base Book context.
- Preserved authorization, installation, owner, and open and unlocked Collection preflight order; denied requests do not invoke the accounting operation.
- Translated the legacy locked no-write outcome to the structured `400` API error while successful operations use the shared `200 OK` operation response.
- Added deterministic facade coverage; 95 client tests, 134 server tests, strict typechecks, production client and Worker builds, and formatting pass, and generated files remain stable across repeated generation.

Post-chunk contract adjustment:

- Replaced the four `204 No Content` success responses with one shared `200 OK` `{ message: string }` schema so the UI can receive operation commentary.
- Kept the accounting implementations and `Summary` unchanged in the API-contract step; the initial API-only boundary returned an empty message.
- Regenerated client types and verified 95 client tests, 134 server tests, strict typechecks, production client and Worker builds, formatting, and repeated-generation stability.

Post-chunk Summary adjustment:

- Retained the migrated `Summary` class and fluent operation methods while replacing GAS-only result serialization with typed states and direct UI messages; parameterless completion now returns `Done!` without the legacy empty-object serialization artifact.
- Replaced Reset's serialized-message lock comparison with the typed locked state; the facade now translates that state to the structured error using the separate message.
- Wired regular and Full Reset success messages through the shared API response. Calculate and Forward retain empty placeholders until their operation ports.
- Added focused Summary, facade, and route coverage; the complete gate passes with 95 client tests and 134 server tests.

**Gate:** Reset and Full Reset leave no unintended active movement, retain accepted forward-state differences, and perform no mutation when preflight or lock requirements fail.

### Chunk 13 — Port Calculate

**Status: In progress — Subchunk 1 complete.**

Regular Reset from Chunk 12 is an implementation dependency: when the legacy Calculate path finds `needs_rebuild`, it invokes regular Reset and returns instead of continuing calculation.

This chunk is a parity port, not a calculation redesign. A `new/server/src/api/services/calculate/` subdirectory may organize the existing Calculate files, but it is only an organizational boundary. `CalculateRealizedResultsService` remains one service, its large `processSale` method remains one method, and its branch, lookup, property, relationship, and mutation order remain aligned with legacy. Existing helper-method boundaries remain intact; `CalculateRealizedResultsProcessor` remains a separate ordered mutation coordinator; `StockAccount` remains a separate shared wrapper; and Calculate dependencies extend the existing target `BotService` instead of being redistributed into newly designed rule, loader, rate, Account, or movement modules. Deeper modularization remains post-migration work.

The agreed target structure preserves those boundaries explicitly:

```text
new/server/src/api/services/
├── calculate-service.ts
├── bot-service.ts
├── stock-account.ts
└── calculate/
    ├── types.ts
    ├── calculate-realized-results-processor.ts
    └── calculate-realized-results-service.ts
```

`calculate-service.ts` remains the thin API facade, `bot-service.ts` is extended in place, `stock-account.ts` remains reusable by later operation ports, and `calculate/` mirrors only the legacy file-level decomposition.

Planned committable subchunks follow the existing legacy file and method boundaries rather than splitting one large method into artificial intermediate implementations:

1. Port supporting constants, calculation model, log types, and the async `StockAccount` adaptation in the agreed target structure without wiring Calculate.
2. Port the legacy `BotService` methods required by Calculate, preserving price and rate precedence, FIFO comparison, gain calculations, query behavior, and support Account inference.
3. Port `CalculateRealizedResultsProcessor` with its established Maps, Sets, temporary ids, MTM accumulation, canonical-id replacement, and ordered batch phases. Preserve its legacy return behavior except for explicit target-runtime awaiting, and do not add API response tracking.
4. Port the helper methods already separated in the legacy Calculate service, including logs, rate recording, Account lookup and creation, realized, FX, MTM, interest-MTM, and Account-date behavior; keep them in `CalculateRealizedResultsService`.
5. Port the complete `processSale` method in place as one parity unit, preserving its long, multiple-lot, partial, short-sale, split, historical-only, fair-only, combined, and MTM branches together with their exact branch, property, relationship, and mutation order. Cover the complete behavior matrix without extracting a new calculation engine or landing deliberately incomplete versions of the method.
6. Port entry orchestration, preserve the `needs_rebuild` Reset-and-return dependency, perform locked-resource checks before support Account creation or any other mutation, and preserve transaction loading and FIFO sorting. Keep the Calculate API stub non-mutating and do not add response tracking, schema changes, route wiring, or facade integration in this parity subchunk.
7. After Calculate behavior is fully ported and covered, wire the accepted shared `200 OK` operation response by replacing the non-mutating API stub. Keep error translation in `calculate-service.ts` and do not add mutation tracking to the parity implementation.

Subchunk 1 evidence:

- Established the organizational `calculate/` directory with the legacy calculation model and log entry types.
- Added only the Calculate-required constants and `StockAccount` realized-date and rebuild behavior, preserving legacy date precedence and the existing asynchronous target Account and Group boundaries.
- Kept the Calculate API stub non-mutating and unwired.
- Verified the complete local gate with 95 client tests, 136 server tests, strict typechecks, production client and Worker builds, formatting, and generated-file drift checks.

- Port FIFO ordering, complete and partial lots, short sales, splits, logs, checked state, and model branches.
- Port explicit and inherited rates, realized and historical results, exchange results, MTM, historical MTM, and interest-MTM movements.
- Port support Account lookup, creation, type inference, and Group inference.
- Preserve canonical Portfolio split ids before dependent Financial and Base Book movements are created.
- Preserve the ordered Portfolio, Financial, and Base Book batch phases and per-Account outcomes.

**Zero-sum gate:** Every Calculate result is a complete movement with the accepted amount and direction, and a failed preflight or locked-resource path performs no mutation.

### Chunk 14 — Port Forward Date and lower-date repair

**Status: Not started.**

This chunk is a strict parity port of the complete legacy `ForwardDateService` behavior and of the separate immediate and sequential `resetRealizedResultsForAccountSync` behavior used only by lower-forward-date repair. Every validation, branch, query, recursive lookup, balance read, property, relationship, remote id, state transition, no-op, delay, mutation, failure boundary, and return outcome remains aligned with legacy unless an unavoidable target-runtime adaptation is explicitly recorded. The target awaits asynchronous SDK work but does not batch, parallelize, reorder, deduplicate, or redesign the established Forward sequence.

`ForwardDateService` remains one service with its existing top-level routing, regular-forward, lower-date-repair, Transaction-forwarding, state-update, builder, balance, and lookup method boundaries. In particular, regular Forward retains the immediate sequence that posts each history log and then updates its source Transaction; it does not gain a processor. The liquidation bridge, batch check, forwarded result, Portfolio Account update, five-second pre-closing delay, and optional Portfolio Book closing-date update retain their established order. The delay is intercepted deterministically in tests rather than removed based on unverified target-runtime assumptions.

The agreed target structure uses a dedicated organizational directory consistent with Reset and Calculate:

```text
new/server/src/api/services/
├── forward-service.ts
├── bot-service.ts
├── stock-account.ts
├── forward/
│   └── forward-date-service.ts
└── reset/
    ├── reset-realized-results-processor.ts
    └── reset-realized-results-service.ts
```

`forward-service.ts` remains the thin API and authorization facade, `bot-service.ts` and `stock-account.ts` are extended in place, `forward/` is organizational only, and the sequential Reset variant remains a distinct method in the existing Reset service rather than being deduplicated with its batched implementation.

Planned committable subchunks follow the existing legacy service and major method boundaries:

1. Establish the agreed Forward structure and port the remaining Forward-specific constants, `StockAccount` behavior, and existing `BotService` dependencies without wiring the Forward route.
2. Port regular Forward Date and its existing helper methods as one parity unit: ordered balance reads, FIFO input selection, history-log posting, immediate source-Transaction updates, liquidation bridge creation, batch checking, unrealized-balance reads, forwarded-result creation, Portfolio Account state, deterministic five-second delay, and optional Portfolio Book closing-date update. Keep the API stub non-mutating.
3. Port lower-forward-date repair together with the separate sequential Reset variant: current-forward Reset, forwarded-Transaction discovery, recursive previous-state lookup, restoration, superseded-log cleanup, requested-date Reset, and re-forwarding in the established order. Enforce owner and open and unlocked Collection requirements before the first mutation.
4. Port the top-level Forward Date validation and branch order, including uncalculated-result, equal-forward-date, lower-date, realized-date, and rebuild behavior. Keep the Forward API stub non-mutating and do not add response tracking, schema changes, route wiring, or facade integration in this parity subchunk.
5. After regular and lower-date Forward behavior is fully ported and covered, wire the accepted shared `200 OK` operation response by replacing the non-mutating API stub. Keep error translation in `forward-service.ts` and do not add mutation tracking to the parity implementation.

- Port Forward Date validation, balances, forward logs, liquidation bridges, forwarded results, and Account state.
- Port optional Portfolio Book closing-date updates after all required movements and checks complete.
- Port lower-forward-date reset, previous-state repair, cleanup, and re-forward behavior.
- Preserve owner, unlocked-Collection, uncalculated-result, rebuild, and date-order requirements.

**Zero-sum gate:** Forward Date and lower-date repair preserve complete movements, accepted relationships, and lifecycle state in every participating Book.

### Chunk 15 — Port and modernize the menu client

**Status: Not started.**

- Replace GAS templates and `google.script.run` with Lit and the authenticated generated API client, including shared successful operation-message handling.
- Implement Calculate, Reset, Full Reset, and Forward Date workflows.
- Preserve the legacy action-time pending-task guard: after an operation click, check the Portfolio Book backlog once before the first Account request, and abort the complete batch without mutation when pending tasks exist.
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
