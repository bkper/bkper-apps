# Exchange Bot: GCP and Apps Script to Cloudflare Migration Roadmap

## Status

**Chunks 1–16 complete. The existing GCP event handler and Google Apps Script web app remain production-authoritative.**

The Cloudflare target is deployed to preview, both development surfaces route to it, and API and client Book-permission hardening and preview event validation are complete. Preview menu and Exchange Update validation is next. No production deployment or production menu or webhook routing change has been performed.

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
- Users continue to choose a date, review or edit rates, run Exchange Update for the established set of Books, and see per-Book progress and results.
- Exchange Account selection, Account creation, Group assignment, Account type selection, historical handling, balance queries, exchange conversion, movement direction, descriptions, properties, batching, and results remain unchanged. Each successful per-Book Exchange Update internally triggers that Book's audit.

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
- The legacy Close button is omitted as an accepted UI-only deviation; users close the menu through the host or browser controls.
- The browser calls only authenticated app API routes for operations previously performed through Apps Script.
- The public API initially exposes exactly `GET /api/v1/books/{bookId}/exchange-rates` and `POST /api/v1/books/{bookId}/exchange-update`, documented at `/openapi.json`.
- GET returns an `ExchangeRates` payload. POST accepts that payload directly, uses its single `date` field, updates one Book, internally triggers that Book's audit, and returns canonical Bkper Account and Transaction API payloads.
- API authorization applies explicitly to the path Book identified by `{bookId}`. GET accepts the view-capable `VIEWER`, `POSTER`, `EDITOR`, and `OWNER` permissions. POST accepts only `EDITOR` and `OWNER`. Permission values use explicit allowlists rather than an assumed hierarchy.
- Missing or inaccessible Books inferred from Collection configuration are not part of API authorization. Bkper Core remains authoritative for every connected-Book request the operation actually makes.
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

The server now pins `bkper-js` 2.42.0 exactly. The original 2.19.0 pin was a conservative migration control: it matched the validated Subledger Bot Worker baseline, stayed close to the active GCP image's verified 2.18.0 dependency, and was the nearest version already validated with the Platform transport. No roadmap constraint or production patch required retaining it.

That pin became unacceptable for Exchange Update because 2.19.0 performs an API request for every `Account.getGroups()` call even after `getBook(id, true)` has loaded the complete chart. Local observations showed roughly 30–40 second Exchange Update requests versus roughly 5 seconds in the production GAS app. These observations motivated the compatibility migration; deterministic tests do not establish a new runtime result.

Version 2.42.0 was selected because it includes the 2.29.1 embedded Account-to-Group cache resolution, the 2.31.2 cached-empty-Group fix, and support for omitted OAuth providers under Platform outbound authentication. It also introduces the post-2.26.0 404 contract in which missing `getAccount()`, `getGroup()`, and `getTransaction()` resources throw `BkperError` rather than returning `undefined`.

The server preserves legacy absence semantics through one narrow optional-lookup helper. It converts only `BkperError` with code 404 to `undefined` at audited optional boundaries and rethrows authentication, permission, network, validation, and server failures. The audited optional boundaries are Exchange Update matching and Exchange Account lookups; exact currency Group fallback; configured Exchange Account selection; event Account and Group rename/trailing-space fallbacks; missing mirror Account and Group creation lookups; optional parent Groups; remote transaction fallbacks; and connected Account lookup before creation. The source Account id lookups required to update an existing mirrored transaction remain required and are not wrapped.

The dependency audit also confirmed:

- Complete-chart Account Group references and Groups with no Accounts resolve through Book caches without per-resource requests.
- SDK retries are now limited to three retries for 401, 403, 408, 429, server responses, and recognized fetch failures; non-retryable client errors fail immediately. Exchange Bot configures no SDK retry handler, and its separate exchange-rate provider retry behavior is unchanged.
- `BkperError` remains serialized by event ingress through the established stack-array response. API route failures retain their existing curated error boundary.
- The server still constructs request-scoped `Bkper` instances without OAuth, agent-id, or API-key providers so Platform outbound authentication remains authoritative.
- The Account, Group, and Transaction mutation methods used by Exchange Bot retain their request payload and operation behavior across this SDK range. Lookup wrapping adds no API calls and does not change movement construction, mutation order, responses, or the zero-sum invariant.

The completed Chunk 8 event dependency/parity audit was reopened for this compatibility migration. Every server `getAccount()`, `getGroup()`, and `getTransaction()` call was reclassified, event responses and mutation paths were rerun deterministically, and representative local runtime and request-boundary evidence was completed in Chunk 13. Live external-service latency and deployed runtime behavior remain part of the separately approved preview validation chunks.

Bkper CLI, Miniflare, TypeScript, and related dependency versions remain subject to their relevant compatibility audits. Accepted versions are pinned exactly in the committed lockfile.

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

### Menu API behavior matrix

#### Book authorization

- GET authorizes only `VIEWER`, `POSTER`, `EDITOR`, or `OWNER` on its path Book before any exchange-rate provider request.
- POST authorizes only `EDITOR` or `OWNER` on its path Book before any balance query, Account or Transaction creation, batch operation, or audit.
- `RECORDER`, `NONE`, and missing permissions fail closed with the shared typed API error envelope and HTTP `403`; direct authorization failures identify the allowed permissions and the caller's current path-Book permission without including a Book name or id.
- Bkper SDK `403` failures retain their upstream message in the typed API error envelope and preserve HTTP `403`, keeping them distinct from direct path-Book authorization failures.
- Authentication remains the Platform dispatch boundary: missing or invalid bearer authentication is `401`, while an authenticated caller lacking the operation-specific Book permission is `403`.
- Authorization does not infer failure from configured currencies or Books absent from the caller's visible Collection. Any connected-Book request actually made remains subject to Bkper Core authorization.

#### Rate loading

- The selected date and Book produce the same endpoint configuration and request source.
- Returned rates preserve the requested effective date, provider base, connected currency filtering, and editable values.
- Results and failures preserve established client-visible behavior.

#### Exchange Update

- Each request updates only its path Book using the supplied `ExchangeRates` payload and effective date.
- Balance queries, historical behavior, matching Accounts, exchange Account selection, Account creation, Group assignment, Account type selection, conversions, rounding, movement direction, descriptions, properties, batching, and operation order remain unchanged.
- Every generated transaction remains one complete movement with one amount.
- Accepted Bkper batch payloads are flattened in established order and returned directly as `bkper.Transaction[]`.
- Each successful update, including a no-op, internally triggers that Book's audit after batch acceptance.

### Client behavior matrix

- The client reads the selected `bookId` from the menu URL.
- Authentication initialization and login-required behavior use `@bkper/web-auth`.
- The client establishes an authenticated session and loads the selected Book, Collection, connected Books, permissions, pending tasks, bot responses, base-Book eligibility, and default date directly through client-side `bkper-js`.
- The main Exchange Update UI is initialized and rendered only when the selected path Book has a view-capable `VIEWER`, `POSTER`, `EDITOR`, or `OWNER` permission. `RECORDER`, `NONE`, and missing permissions render a dedicated access-denied state and perform no menu API request.
- A view-capable caller may load rates, change the date, and edit rate inputs. Run remains disabled unless every concrete eligible Book that the action would target with POST has `EDITOR` or `OWNER` permission.
- Connected Books that are not concrete POST targets do not affect Run authorization. Configured currencies or Books absent from the visible Collection, pending bot tasks, and bot errors produce independent neutral warnings that are all shown together and never hide controls or disable Run.
- Client action handling repeats the edit-permission guard before issuing POST. A server `403` is shown immediately and is never retried; other established per-Book progress, failure, and retry behavior remains unchanged.
- Initial loading, permission, warning, waiting, rates, result, retry, and error states preserve the existing workflow except for the explicit permission hardening above.
- Date changes reload rates through the typed API.
- Rates remain editable before Exchange Update execution.
- When Run is enabled, the client calls Exchange Update once per eligible target Book and preserves established per-Book progress and results; it never silently skips an unauthorized target.
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

**Status: Complete.**

- Ported Account lookup, create, update, rename, archive, and delete behavior with the established field, Group, property, and response handling.
- Ported Group lookup, create, update, rename, hierarchy, hidden state, property preservation, and delete behavior.
- Ported selected Book-setting synchronization in the established condition and mutation order.
- Added one deterministic test module per production handler, preserving the existing Exchange Bot and Subledger Bot test organization without shared test abstractions.
- Confirmed resource synchronization uses only Account, Group, and Book operations and creates no transaction movement.

**Gate:** Resource synchronization has deterministic parity and introduces no additional transaction movement.

### Chunk 8 — Complete event parity and drift audit

**Status: Complete.**

- Ran the complete deterministic event matrix, including ingress, orchestration, connected Books, exchange rates, transaction lifecycles, resource synchronization, responses, errors, and zero-sum safeguards.
- Compared every target event handler and service with its legacy counterpart after reverting non-mandatory porting changes.
- Confirmed that the legacy event source remains unchanged from the migration baseline. The initial audit covered the pinned event-side SDK transition from `bkper-js` 2.18.0 to 2.19.0; the later dedicated 2.42.0 compatibility migration reopened the dependency/parity audit as recorded under SDK and tooling versions.
- Reviewed target metadata, exact dependency resolution, generated environment and OpenAPI artifacts, and production bundle. Confirmed that production menu and webhook URLs remain on Apps Script and GCP and that the production patch ledger remains empty.

**Gate:** No unexplained event-side difference remains in branch order, lookup order, movement direction, amount, transaction state, API-call order, side effects, or responses.

### Chunk 9 — Define the typed menu API contract

**Status: Complete.**

- Defined exactly `GET /api/v1/books/{bookId}/exchange-rates` and `POST /api/v1/books/{bookId}/exchange-update`.
- Added the shared validated `ExchangeRates` contract with one effective `date` field.
- Defined POST as one-Book Exchange Update returning canonical `bkper.Transaction[]` API payloads without re-validating Bkper-owned response fields.
- Added thin routes backed by non-mutating `501 Not Implemented` `ExchangeRatesService` and `ExchangeUpdateService` stubs, centralized transport errors, OpenAPI documentation, generated client contract types, and retained contract tests.
- Excluded menu initialization, public audit, and the commented-out transaction-update operation.

**Gate:** API and OpenAPI tests protect the intended transport replacement without implementing or changing menu business behavior.

### Chunk 10 — Port rate loading

**Status: Complete.**

- Ported menu-side default and custom rate endpoint configuration with the established date and agent substitutions.
- Ported Worker-native provider loading and connected-currency filtering across the established Book relationship sources.
- Preserved the requested date as the returned effective date and moved the Open Exchange Rates identifier to the declared platform secret boundary.
- Added deterministic coverage for default and custom endpoints, connected currencies, editable rate values, date handling, and provider failures.

**Gate:** The target API returns production-equivalent rate results for deterministic fixtures.

### Chunk 11 — Port Exchange Update and internal audit

**Status: Complete.**

- Ported the Apps Script Gain/Loss behavior mechanically into the per-Book Exchange Update endpoint.
- Preserved balance queries, historical behavior, matching Accounts, exchange Account selection and creation, conversion, rounding, movement construction, batching, and order.
- Returned accepted Bkper batch payloads in established order and internally triggered the target Book's audit after every successful update, including a no-op.
- Added deterministic coverage for no-op audits, gain and loss directions, accepted result order, historical Accounts, and exchange Account creation, Groups, and type.

**Zero-sum gate:** Every generated Exchange Update transaction is one complete movement with one amount and the established direction.

### Chunk 12 — Port the menu client

**Status: Complete.**

- Replaced server-rendered Apps Script HTML and `google.script.run` with Lit rendering and the generated authenticated API client.
- Established an authenticated session and loaded the selected Book, Collection, connected Books, permissions, pending tasks, bot responses, base-Book eligibility, and default date through client-side `bkper-js`.
- Preserved the date, editable rates, waiting indicators, button actions, per-Book Exchange Update orchestration, progress, results, retry flow, and errors.
- Used Web Awesome components and Bkper design tokens, including current component size values without deprecation warnings.
- Added retained controller, API, service, utility, and component behavior tests.
- Completed non-mutating browser verification of authentication, Book context, live rate loading, date reload, rate editing, busy controls, warnings, help, responsive layout, and light and dark themes.
- Passed the complete deterministic local gate with client and server typechecks, 172 tests, production client and Worker builds, formatting, and generated-contract checks.

**Gate:** The client behavior matrix passes and the new UI preserves the existing workflow and outcomes.

### Chunk 13 — Full-stack parity, dependency, and runtime audit

**Status: Complete.**

- Passed the complete target gate from a frozen install: strict client and server typechecks, 175 retained tests, client and Worker production builds, formatting, OpenAPI generation, and generated-contract drift checks.
- Rebuilt the client and Worker twice with identical artifacts. The client bundle contains the expected static entry point and assets, and the Worker bundle contains the expected health, OpenAPI, event, and two menu API routes without Node built-in imports.
- Reverified the unchanged legacy event source with its eight retained tests and production build. Reverified the unchanged Apps Script source with its declared TypeScript compiler and its intended GAS and Bkper type boundaries. Both legacy source trees remain unchanged from the migration baseline.
- Compared event orchestration, exchange-rate behavior, transaction lifecycles, resource synchronization, menu initialization, rate loading, Exchange Update, and client orchestration with their authoritative legacy implementations. Movement direction, amount, state, mutation order, responses, and the zero-sum safeguards remain covered by retained deterministic tests.
- Confirmed exact direct dependency pins and lockfile resolution. Revalidated `bkper-js` 2.42.0 optional-lookup semantics and complete-chart Group caching, including zero network requests for embedded Account-to-Group and empty-Group resolution.
- Repeated representative complete posted-movement, gain/loss Exchange Update, and SDK chart-cache fixtures without failure. The gain/loss fixture retained connected-Book batch order, one complete gain movement, one complete loss movement, and the final audit. Local fixture timing is supporting evidence only; deployed external latency remains for preview validation.
- Retained the approved request-boundary optimizations: a connected currency with no matching target Accounts performs no chart load, balance query, or empty batch, while matching Books retain established transaction and batch order.
- Retained the approved safety deviation from the flawed GAS retry fan-out: a failed Book retries independently and never resubmits another Book whose mutations were already accepted.
- Retained the approved per-Book audit boundary: every successful Exchange Update request, including a no-op, audits its own path Book rather than waiting for the complete multi-Book client run.
- Reconfirmed the mandatory Platform adaptations already recorded by earlier chunks: request-scoped outbound authentication, Worker-native rate fetching and isolate cache, SDK 404 absence translation at optional boundaries, the typed API transport and effective date, canonical accepted transaction payloads, generated client types, direct browser authentication, and the omitted Close button.
- Reconciled the empty production patch ledger and reviewed the complete metadata diff. Production menu and webhook routes remain on Apps Script and GCP. Team-wide developer access is the intended final metadata state, but the single-operator restriction remains in effect throughout the remaining migration work to prevent local or preview targets from receiving colleagues' development events.

**Gate:** Passed. No unexplained difference remains across the active production behavior matrix; approved safety and runtime deviations are recorded above.

### Chunk 14 — Preview deployment and routing readiness

**Status: Complete.**

- Built the preview candidate from a clean frozen install and passed strict typechecks, 175 retained tests, client and Worker production builds, formatting, and generated-contract checks.
- Reviewed the metadata diff and kept developer access restricted to the single migration operator.
- Deployed the target to preview and configured the preview Open Exchange Rates secret without changing production routing.
- Synced `menuUrlDev` and `webhookUrlDev` to the preview application while retaining the Apps Script production menu and GCP production webhook.
- Confirmed authenticated preview client loading, client assets, OpenAPI, API authentication and access, event ingress, expected no-op handling, successful event handling, and preview log availability. Unauthenticated client and health requests correctly enter the platform login boundary.

**Gate:** Passed. Preview is reachable through both development surfaces while production remains entirely on GCP and GAS.

### Chunk 15 — Enforce API and client Book permissions

**Status: Complete.**

This chunk is an explicitly accepted pre-production security hardening prerequisite, not migration parity. The reusable API can be called directly by scripts, services, and agents, so client-only permission checks are insufficient.

#### Server authorization

- Add one small shared permission helper and enforce authorization inside the API services immediately after loading the path Book.
- Allow GET only for the explicit view-capable permissions `VIEWER`, `POSTER`, `EDITOR`, and `OWNER`.
- Allow POST only for `EDITOR` and `OWNER` because Exchange Update reads balances, may create Accounts, creates complete draft Transaction movements, and triggers a Book audit.
- Reject `RECORDER`, `NONE`, and missing permissions before GET performs a provider request and before POST performs a balance query, connected-Book processing, Account or Transaction creation, batch operation, or audit.
- Return HTTP `403` through the existing `ApiErrorSchema` envelope. Direct authorization messages list the accepted permissions and the caller's current path-Book permission without including a Book name or id.
- Add `403` to the shared typed API responses and regenerate the OpenAPI client contract rather than defining a duplicate error schema.
- Preserve HTTP `403` and the upstream message for Bkper SDK `403` failures at the API boundary so the client does not retry them and they remain distinct from direct authorization failures; leave unrelated SDK errors unchanged.
- Apply these explicit checks only to the two `/api/v1/*` operations. Event ingress remains unchanged.
- Authorize only the path Book named by `{bookId}`. Do not infer authorization failure from configured currencies or from connected Books absent from the caller's visible Collection. Bkper Core remains authoritative for connected-Book requests the operation actually performs.

#### Client authorization and warnings

- Add explicit client predicates for view-capable and edit-capable permissions, using allowlists rather than an assumed permission hierarchy.
- Require a view-capable permission on the selected Book before initializing or rendering the Exchange Update UI. For `RECORDER`, `NONE`, or missing permission, keep the available app shell, render a dedicated access-denied message, and make no menu API request.
- Let view-capable callers see the instructions, inputs, rates, and buttons and use GET behavior. Disable Run unless every concrete eligible Book that the Run action would target with POST has `EDITOR` or `OWNER` permission.
- Do not let an invisible or missing configured Book, or a connected Book that is not a concrete POST target, affect Run authorization.
- Repeat the edit-permission guard in the action handler so invoking the controller outside the button path cannot issue an unauthorized POST.
- Preserve API status in a small typed client error. Treat `403` as non-retryable and show its permission message immediately.
- Separate missing connected-Book conditions, pending bot tasks, and bot errors from permission errors. Present each condition as an independent non-blocking warning, show all simultaneous warnings in deterministic order, and do not let them hide controls or disable Run.

#### Verification and rollout

- Keep tests lean: one explicit permission table with focused message assertions, one denied-operation no-side-effect assertion per endpoint, one SDK `403` preservation assertion, and the existing OpenAPI contract test extended for `403`.
- Retain only focused client safeguards for access gating, viewer-visible GET controls with Run disabled, concrete POST-target edit permission, non-blocking missing-Book warnings, action-handler enforcement, and non-retried `403` responses.
- Regenerate checked-in OpenAPI client types, run the complete deterministic local gate, and visually verify the final access-denied, viewer, editor, and warning states once after implementation.
- Completed local implementation with explicit server and client permission allowlists, pre-side-effect service guards, detailed direct authorization messages, preserved upstream Bkper SDK `403` messages, per-target client Run authorization, non-retried permission failures, and independent non-blocking context warnings.
- Passed the complete local gate with strict client and server typechecks, 195 retained tests, production client and Worker builds, formatting, and generated-contract verification.
- Visually verified the access-denied, viewer, editor, and combined-warning states with deterministic mocked rates. The viewer retained enabled GET-capable inputs with Run disabled; the editor retained Run; and all simultaneous context warnings remained visible without disabling Run. An accessibility scan reported no violations and one manual contrast review for the Run button.
- Redeployed the accepted permission-hardening candidate to preview through a separately approved operation without changing production routing.
- Confirmed representative authenticated preview behavior: `OWNER` and `VIEWER` GET requests returned `200`, a `VIEWER` POST returned the detailed typed `403` permission response, and an unauthenticated GET returned `401` at the Platform boundary.
- Repeated the denied POST between deterministic Book, Account, and Event snapshots. The request returned `403`, and all normalized snapshots remained unchanged, confirming no denied-operation resource mutation or audit.
- Confirmed the deployed responses in preview request logs. The complete permission allowlists, preserved upstream Bkper SDK `403` behavior, non-retried client permission failures, and simultaneous non-blocking warning states remain covered by the retained deterministic and visual safeguards recorded above.

**Gate:** Passed. The complete deterministic permission matrix and representative authenticated preview checks confirm the deployed authorization boundary without changing production routing or creating a denied-operation side effect.

### Chunk 16 — Preview event validation

**Status: Complete.**

- Created a dedicated private two-Book USD/EUR canary Collection, installed Exchange Bot on the synthetic canary Books, and confirmed development events reached the preview Worker while production routing remained on GCP.
- Exercised Group and Account creation, update, rename, and deletion plus selected Book-setting synchronization. Connected resources retained their identity, type, hierarchy, properties, and expected responses without creating transaction movements.
- Exercised a complete posted movement through update, check, checked-mirror deletion, and restoration. The mirror retained one origin Account, one destination Account, one amount, its remote-id relationship, visible and exchange trace properties, state transitions, direction, and identity without duplication.
- Exercised the converted-zero no-op path and a deliberately unsupported synthetic currency path. The zero conversion created no target transaction; the unsupported rate produced the established error and no partial, draft, or balance-affecting target movement.
- Verified every accounting result through canonical resource re-reads and deterministic per-Account balance assertions. Each Book remained zero-sum, and human review accepted the resulting canary resources and event responses.
- Passed the complete local gate with strict client and server typechecks, 195 retained tests, production client and Worker builds, formatting, and generated-contract verification.

**Gate:** Passed. Deterministic assertions and accepted review found no duplicate, missing, reversed, partial, or imbalanced posted movement.

### Chunk 17 — Preview menu and Exchange Update validation

**Status: Not started.**

- Exercise menu initialization, permissions, warnings, rate loading, rate editing, progress, results, failures, and retry behavior.
- Run isolated Exchange Update canaries with deterministic Books, balances, dates, and rates.
- Verify generated Accounts, Groups, transactions, movement direction, amounts, properties, returned payloads, and per-Book audits.
- Complete final preview visual verification.

**Gate:** The full menu workflow and resulting Bkper resources match accepted legacy behavior.

### Chunk 18 — Final drift audit and production deployment

**Status: Not started.**

- Repeat GCP and Apps Script source drift audits.
- Reconcile all production patches.
- Build the accepted production artifact from a clean frozen install.
- Configure the production Open Exchange Rates secret through a separately approved operation.
- Deploy the accepted full-stack Worker to production while both production routes remain on GCP and GAS.
- Confirm production health, assets, OpenAPI, API protection, and log availability.

**Gate:** Deployment changes runtime availability only; production menu and event routing remain unchanged.

### Chunk 19 — Production webhook cutover and event stabilization

**Status: Not started.**

- Change only the production webhook route from GCP to Cloudflare.
- Keep the production menu on Apps Script and developer routing on preview.
- Monitor Cloudflare event requests, handler responses, authentication, errors, and customer-impact reports.
- Keep the GCP function active and unchanged for immediate routing rollback.
- Validate representative event behavior using accepted deterministic, preview, and production evidence.

**Rollback triggers:** suspected zero-sum or data-loss issues, reversed or partial movements, duplicate processing, sustained authentication failures, material error growth, or missing production event behavior.

**Gate:** Event stabilization is explicitly accepted before menu cutover begins.

### Chunk 20 — Production menu cutover and full-stack stabilization

**Status: Not started.**

- Change only the production menu route from Apps Script to the Cloudflare client.
- Keep the GCP and Apps Script deployments active and unchanged.
- Monitor client loading, authentication, API requests, rate loading, Exchange Update operations, per-Book audits, Worker logs, and customer-impact reports.
- Validate representative menu behavior using accepted deterministic, preview, and production evidence.

**Rollback triggers:** suspected zero-sum or data-loss issues, incorrect movement direction or amount, incomplete Exchange Update operations, sustained authentication or API failures, material error growth, or missing production menu behavior.

**Gate:** Full-stack stabilization is explicitly accepted before repository consolidation.

### Chunk 21 — Repository consolidation and deferred legacy retirement

**Status: Not started.**

- Move the Cloudflare project from `new/` to the `exchange-bot/` root.
- Remove the inactive `legacy/` working-tree copy and obsolete local GCP and Apps Script tooling.
- Update workspace instructions and port forwarding.
- Verify that source, tests, lockfile, generated contracts, configuration, client assets, and Worker behavior remain unchanged through the move.
- Preserve legacy source in Git history.
- Keep the unchanged GCP and Apps Script deployments available as independent routing rollback targets.
- After consolidation and stabilization acceptance, separately restore `developers: '*@bkper.com'` in the working tree, review the exact metadata diff, and sync the team-wide developer access as the final migration operation.

**Gate:** Cloudflare is the only active implementation in the project root. The separately approved final developer-access sync returns app administration to its normal team-wide state; consolidation itself performs no deployment, routing change, legacy infrastructure mutation, or Book write.

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
