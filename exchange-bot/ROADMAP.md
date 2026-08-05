# Exchange Bot: GCP and Apps Script to Cloudflare Migration Roadmap

## Status

**Chunks 1–6 complete. The existing GCP event handler and Google Apps Script web app remain production-authoritative.**

The Cloudflare target now has its full-stack skeleton, event dispatcher and orchestration, connected-Book rules, event-side exchange-rate boundaries, and posted, checked, updated, deleted, and restored transaction behavior. The remaining resource business handlers remain explicit no-op stubs. No preview or production deployment has been performed, and no menu or webhook routing has changed.

## Purpose of this document

Exchange Bot will be the first published Bkper app migration in this repository to move both an event handler and a user-facing web app into one full-stack Bkper Platform application on Cloudflare Workers.

This roadmap starts from the process proven by the Subledger Bot migration, while redefining the architecture, verification, deployment, cutover, rollback, and retirement work required by Exchange Bot.

This is a public, community-facing roadmap. It records technical decisions and reproducible outcomes without retaining raw operational logs, Book or resource identifiers, internal infrastructure identifiers, personal names, secret values, or approval chronology.

## Objective

Migrate the published `exchange-bot` app from:

- a Google Cloud Function that handles Bkper events; and
- a Google Apps Script web app that provides the Exchange Bot menu;

into one Bkper Platform application whose Cloudflare Worker serves:

- the bundled browser client;
- authenticated `/api/v1/*` routes used by that client;
- Bkper event ingress at `/events`; and
- a lightweight `/health` route.

The migration must not intentionally change existing event behavior, menu behavior, exchange calculations, resource mutations, user workflow, or responses. The legacy GCP and Apps Script implementations remain authoritative until their respective production cutovers.

## Non-negotiable invariants

1. **Protect Bkper's zero-sum invariant above all else.** Every posted transaction created or changed by Exchange Bot must remain one complete movement with one amount from an origin Account to a destination Account.
2. **Preserve unresolved movement behavior.** A movement that cannot be completed must retain its established non-balance-affecting behavior.
3. **Migration parity comes first.** Do not combine infrastructure migration with business-logic fixes, redesigns, refactors, optimizations, or feature work.
4. **The legacy implementations are authoritative.** Apparently questionable behavior must remain unchanged unless a deviation is strictly required by the Cloudflare runtime or Bkper Platform boundary.
5. **Production patches must remain synchronized.** Any production change during migration must be characterized in a deterministic target test and ported to the Cloudflare implementation.
6. **Target tests are retained production safeguards.** Each behavior chunk starts with the smallest target production stub and deterministic tests describing the corresponding legacy behavior.
7. **Tests never write to live Books.** Unit tests use controlled SDK, network, API, and browser boundaries without credentials or live Bkper resources.
8. **Deployment and routing are separate.** A deployed Worker does not imply that either production events or the production menu should route to it.
9. **Menu and webhook cutovers are independent.** Each production surface has its own validation, stabilization, and rollback decision.
10. **Remote mutations require explicit approval.** App sync, deploy, secret writes, installation, event replay, routing changes, and Book writes must be reviewed separately immediately before execution.
11. **Keep changes small and reviewable.** Prefer independently mergeable migration chunks over a long-running rewrite.

## Authoritative legacy surfaces

### GCP event handler

The current `events/` project is the authoritative implementation for subscribed Bkper events.

It handles:

- transaction posting, checking, updating, deletion, and restoration;
- Account creation, update, and deletion;
- Group creation, update, and deletion;
- selected Book-setting updates;
- connected-Book resolution;
- exchange-rate retrieval and conversion;
- transaction mirroring, state synchronization, trace properties, and responses.

### Google Apps Script web app

The current `menu/` project is the authoritative implementation for the Exchange Bot menu and its server operations.

The active production surface consists of:

- menu view initialization;
- exchange-rate loading;
- user-edited exchange rates;
- gain/loss updates;
- Book audits after successful updates;
- progress, result, warning, and error presentation.

The commented-out transaction-update operation is not an active production surface and is outside this migration.

## Domain behavior preserved

Exchange Bot connects currency Books and mirrors resource movements using exchange rates.

- Each connected Book is identified by its established Exchange Bot Book properties and relationships.
- Book currency codes, base-Book rules, Account and Group currency matching, and connected-Book selection remain unchanged.
- A mirrored transaction keeps the source date, description, visible properties, movement direction, connected Accounts, state, remote-id relationship, exchange properties, URLs, and file URLs according to the established event path.
- Same-name Account and Group synchronization, automatic resource creation, rename lookup, archived state, Group hierarchy, visible properties, and deletion behavior remain unchanged.
- Transaction posting, checking, updating, deletion, restoration, zero-amount handling, and loop prevention retain their established order and conditions.
- Exchange-rate endpoint selection, date substitution, future-date handling, explicit amount and rate overrides, description-based overrides, conversion precision, retries, and cache behavior remain unchanged except for mandatory runtime-equivalent adaptations.
- Selected Book settings continue to synchronize across connected Books in the established direction and order.
- The menu continues to load the selected Book context, connected Books, permissions, pending work, bot responses, rates, and eligible base Books using the established rules.
- Users continue to choose a date, review or edit rates, run Gain/Loss for the established set of Books, see per-Book progress and results, and trigger the established audit flow.
- Gain/loss Account selection, Account creation, Group assignment, Account type selection, historical handling, balance queries, exchange conversion, movement direction, descriptions, properties, batching, summaries, and audit order remain unchanged.

## Mechanical parity rules

These rules apply to every behavior-porting chunk:

- Preserve source class, function, method, and parameter names where practical.
- Preserve class decomposition, branch order, lookup order, constructor timing, request lifetime, return normalization, logging, API-call order, concurrency, batching, retries, cache semantics, and side effects.
- Preserve the separate event-side and menu-side implementations during migration. Do not consolidate duplicated logic into shared services.
- Do not refactor, modernize, optimize, harden, or clean up legacy business behavior during the parity port.
- Do not add production factories, registries, dependency injection layers, services, adapters, or testing hooks solely for testability.
- Keep test interception outside production architecture and at SDK, network, API, or browser boundaries.
- Limit mechanical changes to runtime boundaries, module syntax, strict TypeScript requirements, request-scoped platform authentication, API transport replacing `google.script.run`, client rendering, Worker-compatible platform APIs, and build packaging.
- Compare the legacy and target implementations side by side before completing each chunk.
- Record and explain every retained deviation required by the target runtime.
- Stop and escalate any required adaptation that could change movement direction, amount, transaction state, resource mutation, user-visible workflow, or the zero-sum invariant.

## Architecture

### Current layout

```text
exchange-bot/
├── events/       # GCP Cloud Function
├── menu/         # Google Apps Script web app
├── bkper.yaml
├── package.json
├── README.md
└── ROADMAP.md
```

### Temporary migration layout

During parity work, both legacy runtimes and the full-stack Cloudflare target remain available for direct comparison:

```text
exchange-bot/
├── legacy/
│   ├── events/   # production-authoritative GCP implementation
│   ├── menu/     # production-authoritative Apps Script implementation
│   ├── bkper.yaml
│   └── package.json
├── new/
│   ├── client/   # Vite + Lit browser client
│   ├── server/   # Hono Worker: /api/v1/*, /events, /health, assets
│   ├── bkper.yaml
│   ├── package.json
│   └── tsconfig.json
└── ROADMAP.md
```

The target app metadata keeps production `menuUrl` and `webhookUrl` on Apps Script and GCP while development URLs point to Cloudflare preview. Only the target project is used for Cloudflare build and deployment operations.

### Intended final layout

After both production surfaces stabilize, the Cloudflare project moves to the app root and the inactive legacy working-tree copy is removed:

```text
exchange-bot/
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

The previous GCP and Apps Script source remains recoverable from Git history. The deployed legacy runtimes remain available as independent routing rollback targets until separately retired.

## Cloudflare target decisions

- One full-stack Worker serves static client assets, `/api/v1/*`, `/events`, and `/health`.
- The client uses Vite, Lit, Web Awesome, `@bkper/web-design`, and `@bkper/web-auth`.
- Client parity preserves the established functionality, workflow, states, and outcomes while adopting the platform design foundation; pixel-for-pixel Apps Script styling is not required.
- The browser calls only authenticated app API routes for operations previously performed through Apps Script.
- Each active `google.script.run` operation receives a typed API contract. Exact route names and schemas are decided during the API chunk and documented at `/openapi.json`.
- Generated OpenAPI client types are consumed by the shipped client.
- Server API routes and event handlers create request-scoped `Bkper` instances without token, API-key, or agent providers.
- Platform outbound authentication supplies the validated user context and `exchange-bot` app identity.
- Worker code never reads or forwards `Authorization`, `bkper-oauth-token`, or `bkper-agent-id`.
- The existing Open Exchange Rates application identifier becomes a declared Bkper Platform secret with independent preview and production values.
- Event-side and menu-side exchange logic remain separate during migration.
- Event exchange rates use an opportunistic module-scoped `Map` per Worker isolate with the established 30-minute TTL and cloned values. Cache loss only causes another provider request; correctness never depends on isolate reuse.
- Strict TypeScript, Bun package management, a committed lockfile, deterministic tests, production builds, formatting, and generated-contract checks form the local gate.
- Local ports use Vite `5177` and Worker `8793`; Worker ports `8791` and `8792` were already assigned elsewhere in the workspace. Workspace instructions and port forwarding include the target.

## Open implementation-time decisions

### SDK and tooling versions

The event-side target pins `bkper-js` 2.19.0, matching the validated Subledger Bot Worker baseline and providing the required platform-compatible SDK behavior. The active GCP image was verified to run `bkper-js` 2.18.0. Client-side SDK selection remains separate because the menu migrates from `bkper-gs` to `bkper-js`.

Bkper CLI, Miniflare, TypeScript, client-side `bkper-js`, and related dependency versions remain subject to their relevant compatibility audits. Accepted versions are pinned exactly in the committed lockfile.

## Deterministic verification strategy

### Test boundary

Tests execute target production handlers, API routes, services, SDK models, client API code, controllers, and components while intercepting only SDK, network, API, or browser boundaries.

They require no credentials, deployment, external exchange-rate request, or live Book access.

Each behavior chunk follows this workflow:

1. Add the smallest target production stub required by the behavior.
2. Add the smallest failing test describing current legacy behavior.
3. Implement only enough target behavior to pass.
4. Run focused tests.
5. Run the complete deterministic gate.
6. Compare target and legacy implementations side by side.
7. Keep the test as a permanent target regression safeguard.

### Event behavior matrix

#### Event ingress and routing

- Every subscribed event reaches the matching handler.
- Unknown events preserve the established no-op response.
- Event results and errors retain their established envelopes and status behavior.
- Authentication moves to the platform boundary without changing handler behavior.

#### Connected Books and exchange rates

- Connected-Book discovery preserves all established sources, filtering, ordering, and base-Book rules.
- Currency matching through Book, Group, Account, and transaction properties remains unchanged.
- Rate endpoint construction, date handling, overrides, fetching, retries, conversion, precision, and cache behavior remain unchanged.
- Existing concurrency and chunking behavior remains unchanged.

#### Transaction movements and state

- Posted and checked transactions preserve target selection, remote-id lookup, date, description, visible properties, movement direction, amount, exchange properties, state, and response text.
- A complete mirrored transaction contains one origin Account, one destination Account, and one amount.
- Established unresolved and zero-amount behavior remains unchanged.
- Update, delete, and restore preserve Account resolution, checked-state handling, URLs, file URLs, trash and untrash transitions, lookup fallback, API-call order, and results.
- Loop-prevention behavior remains unchanged for each event path.

#### Account, Group, and Book synchronization

- Account create, update, rename, archive, and delete preserve established connected-Book behavior.
- Group create, update, rename, hierarchy, hidden state, properties, and delete preserve established behavior.
- Selected Book settings preserve their synchronization conditions, direction, order, and responses.
- Resource handlers do not introduce additional transaction movements.

### Menu server behavior matrix

#### View initialization

- Selected Book, connected Books, currency codes, base-Book flags, permissions, pending work, bot responses, default date, warnings, and initial UI state preserve existing behavior.

#### Rate loading

- The selected date and Book produce the same endpoint configuration and request source.
- Returned rates preserve provider base, connected currency filtering, and editable values.
- Results and failures preserve established client-visible behavior.

#### Gain/loss update

- Eligible Books, balance queries, historical behavior, matching Accounts, exchange Account selection, Account creation, Group assignment, Account type selection, conversions, rounding, movement direction, descriptions, properties, batching, summaries, and operation order remain unchanged.
- Every generated transaction remains one complete movement with one amount.
- Per-Book success and failure responses preserve existing behavior.

#### Audit

- The established set of Books is audited after the established completion condition and in the established order.

### Client behavior matrix

- The client reads the selected `bookId` from the menu URL.
- Authentication initialization and login-required behavior use `@bkper/web-auth`.
- Initial loading, permission, warning, waiting, rates, result, retry, error, and close states preserve the existing workflow.
- Date changes reload rates through the typed API.
- Rates remain editable before Gain/Loss execution.
- Gain/Loss requests preserve the established per-Book invocation and completion behavior.
- The client invokes the audit operation at the established point.
- UI tests protect behavior and public contracts rather than static wording or CSS details.
- Browser verification confirms the completed client visually and interactively before preview acceptance.

### Local gate

The target root check will cover:

- retained unit tests;
- strict client, server, and test typechecks;
- OpenAPI generation and generated client types;
- client production build;
- Worker production build;
- formatting;
- generated-file drift;
- the required UI foundation.

It performs no remote mutation.

## Production patch synchronization

While GCP and Apps Script remain production-authoritative, every production patch must be:

1. identified by affected event or menu behavior;
2. added to a small migration patch ledger;
3. characterized in a deterministic Cloudflare target test;
4. ported when its behavior area is implemented;
5. included in the next source drift audit.

Drift audits occur before preview routing, before production deployment, before each production cutover, and before repository consolidation.

### Migration patch ledger

No production patches have been recorded since the migration baseline. Add one concise row here for each future patch.

| Surface | Behavior changed | Target parity test | Port status |
| --- | --- | --- | --- |
| — | — | — | — |

## Migration chunks

### Chunk 1 — Capture baseline and establish parallel layout

**Status: Complete.**

- Confirmed that the registered production menu, webhook, API version, and twelve event subscriptions match the checked-in configuration. Production remains routed to Apps Script and GCP.
- Confirmed the deployed Apps Script 1.4.0 output matches the checked-in TypeScript compilation and static assets.
- Confirmed the active GCP function uses Node.js 22 and its immutable active image runs `bkper-js` 2.18.0.
- Verified the event project with eight passing unit tests and a successful production build. Verified the menu project with its declared TypeScript 4.9.5 compiler and type packages.
- Created the migration patch ledger, moved the legacy projects and configuration under `legacy/` without behavior changes, and established the isolated `new/` target directory.

**Gate:** Both relocated legacy projects remain source-equivalent and independently verifiable. Production routing remains unchanged.

### Chunk 2 — Create the full-stack Cloudflare skeleton

**Status: Complete.**

- Created the minimal target with root, client, and server package boundaries and no template demo behavior.
- Added strict TypeScript, formatting, generated environment and OpenAPI types, and a committed lockfile.
- Added `/health`, non-mutating typed `/events` and `/api/v1/*` stubs, `/openapi.json`, JSON API not-found behavior, and static asset fallback in one Hono Worker.
- Added the Vite, Lit, Web Awesome, Bkper design, and web-auth client foundation.
- Assigned Vite `5177` and Worker `8793` and updated workspace port forwarding.
- Added target app metadata while keeping production menu and webhook URLs on Apps Script and GCP.

**Gate:** The deterministic local check passes with no app sync, deployment, secret write, routing change, or Book write.

### Chunk 3 — Port event ingress and dispatch

**Status: Complete.**

- Added request-scoped app context and event result types.
- Reproduced the legacy event switch, handler construction, response envelope, logging, and error behavior.
- Added explicit no-op handler stubs before business implementations.
- Confirmed Worker code ignores legacy authentication headers and relies on platform outbound auth.
- Pinned event-side `bkper-js` 2.19.0.

**Gate:** Every subscribed event and unknown-event behavior is characterized deterministically.

### Chunk 4 — Port event orchestration and exchange-rate boundaries

**Status: Complete.**

- Ported connected-Book discovery, currency and base-Book rules, Account currency matching, Book anchors, chunking, concurrency, and rate preloading.
- Ported event-side endpoint construction, date handling, overrides, conversion, and precision.
- Replaced the Node HTTP boundary with Worker-native `fetch` while preserving response parsing, retry status ranges, shared retry counts, delays, errors, and logging.
- Replaced the per-process `node-cache` with an opportunistic per-isolate `Map` preserving the 30-minute TTL and cloned values without KV or another dependency.
- Kept event-side behavior separate from menu-side behavior.

**Gate:** Connected-Book selection and rate results have no unexplained legacy-to-target difference.

### Chunk 5 — Port posted and checked transaction behavior

**Status: Complete.**

- Ported existing remote-id lookup, target eligibility, and loop-prevention behavior.
- Ported Account and Group creation required by transaction mirroring.
- Ported amount and description extraction, exchange trace properties, posting, drafting, and checking.
- Preserved response strings, no-op branches, zero-amount behavior, and existing checked-state call order.
- Added deterministic coverage for complete posted movements, unresolved drafts, automatic resource creation, duplicate prevention, eligibility, checked-state transitions, and trace properties.

**Zero-sum gate:** Every posted mirror is one complete movement with one amount; established unresolved behavior remains non-balance-affecting.

### Chunk 6 — Port transaction update, delete, and restore

**Status: Complete.**

- Ported update behavior for existing and missing mirrors, including Account resolution, amount recalculation, movement direction, visible and exchange properties, URLs, file URLs, and checked-state call order.
- Preserved the established zero-amount path by unchecking checked mirrors before trashing them without creating or updating a posted movement.
- Ported delete and restore behavior, including remote-id queries, the deletion lookup fallback, trash and untrash transitions, responses, and API-call order.
- Added deterministic lifecycle coverage for complete updated movements, zero-amount deletion, missing-mirror creation, checked deletion, fallback lookup, and restoration.

**Gate:** No unexplained difference remains in movement direction, amount, state transition, lookup order, resource mutation, or result.

### Chunk 7 — Port Account, Group, and Book synchronization

**Status: Not started.**

- Port Account create, update, rename, archive, and delete behavior.
- Port Group create, update, rename, hierarchy, properties, and delete behavior.
- Port selected Book-setting synchronization.
- Preserve all established relationship and no-op conditions.

**Gate:** Resource synchronization has deterministic parity and introduces no additional transaction movement.

### Chunk 8 — Complete event parity and drift audit

**Status: Not started.**

- Run the full event behavior matrix.
- Compare every target event handler with its legacy counterpart.
- Review dependency behavior, runtime adaptations, configuration, generated artifacts, and bundle contents.
- Reconcile the production patch ledger.

**Gate:** No unexplained event-side difference remains in branch order, lookup order, movement direction, amount, transaction state, API-call order, side effects, or responses.

### Chunk 9 — Define the typed menu API contract

**Status: Not started.**

- Define one typed API operation for each active Apps Script server operation.
- Keep exact routes and schemas centered on the existing menu domain behavior.
- Add thin Hono routes, typed request and response schemas, standardized transport errors, OpenAPI documentation, and generated client types.
- Add production service stubs before implementations.
- Exclude the commented-out transaction-update operation.

**Gate:** API and OpenAPI tests protect the intended transport replacement without implementing or changing menu business behavior.

### Chunk 10 — Port view initialization and rate loading

**Status: Not started.**

- Port selected-Book context loading and all data used to render the initial menu.
- Port permission, pending-work, bot-response, connected-Book, base-Book, and default-date behavior.
- Port menu-side rate endpoint configuration, loading, filtering, and responses.
- Move the existing Open Exchange Rates identifier to the declared platform secret boundary.

**Gate:** The target API returns production-equivalent initial context and rate results for deterministic fixtures.

### Chunk 11 — Port Gain/Loss and audit operations

**Status: Not started.**

- Port the Apps Script Gain/Loss implementation mechanically into target server services.
- Preserve balance queries, historical behavior, matching Accounts, exchange Account selection and creation, conversion, rounding, movement construction, batching, summaries, and order.
- Port the established audit operation and completion boundary.

**Zero-sum gate:** Every generated gain/loss transaction is one complete movement with one amount and the established direction.

### Chunk 12 — Port the menu client

**Status: Not started.**

- Replace server-rendered Apps Script HTML and `google.script.run` with Lit rendering and the generated authenticated API client.
- Preserve the date, editable rates, waiting indicators, button actions, per-Book progress, summaries, retry flow, errors, audit trigger, and close behavior.
- Use Web Awesome components and Bkper design tokens.
- Add retained controller, API, and component behavior tests.
- Complete browser-based visual and interactive verification.

**Gate:** The client behavior matrix passes and the new UI preserves the existing workflow and outcomes.

### Chunk 13 — Full-stack parity, dependency, and runtime audit

**Status: Not started.**

- Run the complete event, API, menu-service, and client test suites.
- Compare both target surfaces with both legacy implementations.
- Resolve and pin SDK and tooling versions through compatibility evidence.
- Verify the complete client and Worker production builds and generated artifacts.
- Measure representative event and Gain/Loss execution within the target runtime constraints.
- Reconcile the patch ledger and explain every mandatory runtime deviation.

**Gate:** No unexplained difference remains across the active production behavior matrix.

### Chunk 14 — Preview deployment and routing readiness

**Status: Not started.**

- Build and review the preview candidate from a clean frozen install.
- Review the exact target metadata diff.
- Configure the preview Open Exchange Rates secret through a separately approved operation.
- Deploy the target to preview without changing production routing.
- Point `menuUrlDev` and `webhookUrlDev` to the preview application through a separately approved app sync.
- Confirm preview health, client assets, OpenAPI, authentication, event ingress, API access, and log availability.

**Gate:** Preview is reachable through both development surfaces while production remains entirely on GCP and GAS.

### Chunk 15 — Preview event validation

**Status: Not started.**

- Exercise representative transaction, Account, Group, and Book event paths in isolated synthetic Books.
- Validate converted movement direction, amount, state, remote-id relationship, properties, and responses.
- Validate the established unresolved and no-op paths.

**Gate:** Deterministic assertions and human review find no duplicate, missing, reversed, partial, or imbalanced posted movement.

### Chunk 16 — Preview menu and Gain/Loss validation

**Status: Not started.**

- Exercise menu initialization, permissions, warnings, rate loading, rate editing, progress, results, failures, retry, and close behavior.
- Run isolated Gain/Loss canaries with deterministic Books, balances, dates, and rates.
- Verify generated Accounts, Groups, transactions, movement direction, amounts, properties, summaries, and audits.
- Complete final preview visual verification.

**Gate:** The full menu workflow and resulting Bkper resources match accepted legacy behavior.

### Chunk 17 — Final drift audit and production deployment

**Status: Not started.**

- Repeat GCP and Apps Script source drift audits.
- Reconcile all production patches.
- Build the accepted production artifact from a clean frozen install.
- Configure the production Open Exchange Rates secret through a separately approved operation.
- Deploy the accepted full-stack Worker to production while both production routes remain on GCP and GAS.
- Confirm production health, assets, OpenAPI, API protection, and log availability.

**Gate:** Deployment changes runtime availability only; production menu and event routing remain unchanged.

### Chunk 18 — Production webhook cutover and event stabilization

**Status: Not started.**

- Change only the production webhook route from GCP to Cloudflare.
- Keep the production menu on Apps Script and developer routing on preview.
- Monitor Cloudflare event requests, handler responses, authentication, errors, and customer-impact reports.
- Keep the GCP function active and unchanged for immediate routing rollback.
- Validate representative event behavior using accepted deterministic, preview, and production evidence.

**Rollback triggers:** suspected zero-sum or data-loss issues, reversed or partial movements, duplicate processing, sustained authentication failures, material error growth, or missing production event behavior.

**Gate:** Event stabilization is explicitly accepted before menu cutover begins.

### Chunk 19 — Production menu cutover and full-stack stabilization

**Status: Not started.**

- Change only the production menu route from Apps Script to the Cloudflare client.
- Keep the GCP and Apps Script deployments active and unchanged.
- Monitor client loading, authentication, API requests, rate loading, Gain/Loss operations, audits, Worker logs, and customer-impact reports.
- Validate representative menu behavior using accepted deterministic, preview, and production evidence.

**Rollback triggers:** suspected zero-sum or data-loss issues, incorrect movement direction or amount, incomplete Gain/Loss operations, sustained authentication or API failures, material error growth, or missing production menu behavior.

**Gate:** Full-stack stabilization is explicitly accepted before repository consolidation.

### Chunk 20 — Repository consolidation and deferred legacy retirement

**Status: Not started.**

- Move the Cloudflare project from `new/` to the `exchange-bot/` root.
- Remove the inactive `legacy/` working-tree copy and obsolete local GCP and Apps Script tooling.
- Update workspace instructions and port forwarding.
- Verify that source, tests, lockfile, generated contracts, configuration, client assets, and Worker behavior remain unchanged through the move.
- Preserve legacy source in Git history.
- Keep the unchanged GCP and Apps Script deployments available as independent routing rollback targets.

**Gate:** Cloudflare is the only active implementation in the project root. Consolidation performs no app sync, deployment, routing change, legacy infrastructure mutation, or Book write.

## Rollback strategy

### Event rollback

The retained GCP function can receive production events again through a configuration-only webhook change.

During event rollback:

1. stop and identify the trigger;
2. restore the retained GCP webhook in app metadata;
3. review the exact configuration diff and remote sync command;
4. obtain explicit approval before syncing;
5. confirm persisted routing and inspect event handling;
6. keep Cloudflare deployed for incident analysis.

### Menu rollback

The retained Apps Script deployment can serve the production menu again through a configuration-only menu URL change.

During menu rollback:

1. stop and identify the trigger;
2. restore the retained Apps Script menu URL in app metadata;
3. review the exact configuration diff and remote sync command;
4. obtain explicit approval before syncing;
5. confirm persisted routing and menu access;
6. keep Cloudflare deployed for incident analysis.

The active repository will no longer contain deployable legacy projects after consolidation. Rebuilding either retained deployment requires recovery from Git history and a separate reviewed incident plan.

## Completion definition

### Application migration complete

- Cloudflare handles production Exchange Bot events.
- Cloudflare serves the production Exchange Bot menu and authenticated API.
- The full active event and menu behavior matrices have retained deterministic parity coverage.
- Zero-sum and movement-direction checks pass.
- Client visual and interactive verification passes.
- Preview, both cutovers, and both stabilization gates pass.
- The Cloudflare full-stack app occupies the project root.
- GCP and Apps Script remain available as independent routing rollback targets.

### GCP retirement deferred

Deleting the retained GCP function, source artifacts, IAM bindings, secrets, or related infrastructure requires a future plan and explicit approval.

### Apps Script retirement deferred

Deleting the retained Apps Script project, deployment, properties, credentials, or related infrastructure requires a future plan and explicit approval.

Time elapsed alone is not a retirement criterion for either legacy runtime.

## Optional post-migration work

Any intentional business-logic change, bug fix, response hardening, API evolution, client workflow change, UI redesign, shared-service extraction, cache redesign, dependency modernization, or legacy infrastructure retirement is separate from migration completion.

Such work begins only after stabilization and must have its own scope, tests, review, deployment evidence, and explicit approval. It must prove that resource movements, balances, and Bkper's zero-sum invariant remain protected.
