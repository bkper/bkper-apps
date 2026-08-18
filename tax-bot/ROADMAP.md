# Tax Bot: GCP to Cloudflare Migration Roadmap

## Status

**The Cloudflare application migration and repository consolidation are complete. GCP retirement is intentionally deferred.**

The production Cloudflare Worker now occupies the `tax-bot/` project root, and production and developer events route to their corresponding Cloudflare environments. Deterministic parity, preview validation, production cutover, and accepted stabilization completed without a rollback trigger. The accepted GCP source was removed from the active working tree and remains recoverable from Git history; the unchanged Google Cloud Function remains active as the immediate routing rollback target.

## Purpose of this document

This roadmap adapts the completed Subledger Bot migration process to Tax Bot. It reuses the proven migration structure while replacing Subledger-specific consolidation assumptions with Tax Bot's calculation, movement, lifecycle, and loop-prevention behavior.

This is a public, community-facing roadmap. It records technical decisions and reproducible outcomes without retaining raw operational logs, Book or resource identifiers, internal infrastructure identifiers, personal names, or routine approval chronology.

## Objective

Migrate the published `sales-tax-bot` app from Google Cloud Functions to the Bkper Platform on Cloudflare Workers without intentionally changing its business behavior.

The Cloudflare implementation ran in parallel with the GCP implementation until deterministic parity and live canaries passed. The GCP implementation remained authoritative until production event routing was explicitly cut over in Chunk 13.

## Non-negotiable invariants

1. **Protect Bkper's zero-sum invariant above all else.** Every posted tax Transaction must remain one complete movement with one amount, one origin Account, and one destination Account.
2. **Unresolved tax movements remain drafts.** A tax description that does not resolve both Accounts must not affect balances.
3. **The source Transaction is never mutated.** Tax Bot creates or trashes linked tax Transactions without altering the movement that triggered it.
4. **Migration parity comes first.** Do not combine the infrastructure migration with intentional tax-rule changes, bug fixes, redesigns, or documentation-driven reinterpretations.
5. **Tax calculations remain deterministic.** Rates and overrides come only from established Account, Group, and Transaction properties; no new jurisdictional rules or inferred rates are introduced.
6. **Idempotency is preserved.** Remote ids continue to identify each generated tax entry by tax property, source Transaction, and triggering Account or Group.
7. **Implementation tests never write to live Books.** Use unit tests with controlled SDK and network boundaries.
8. **The existing production implementation remains authoritative until cutover.** Any production patch during migration must be translated into a deterministic test and the Cloudflare implementation.
9. **Deployment and routing are separate.** A deployed Worker does not imply that production events should route to it.
10. **Remote mutations require explicit approval.** App sync, deploy, install, replay, routing changes, canary writes, and all Book-write operations must be reviewed separately.
11. **Keep changes small and reviewable.** Prefer independently mergeable chunks over a long-running rewrite.

## Production baseline

The confirmed production dependency baseline is `bkper-js` `2.18.0`.

The checked-in GCP source was reviewed against the accepted deployed runtime artifact and accepted as the migration source baseline before relocation into `legacy/`.

The legacy project has no deterministic unit test suite or committed dependency lockfile. Its pre-move build succeeded, but deterministic behavior coverage remains a Cloudflare migration requirement rather than established legacy evidence.

## Domain behavior to preserve

Tax Bot creates additional tax movements in the same Book when eligible source Transactions are posted, restored, updated, or deleted.

- Both Accounts in the source movement are inspected.
- Each Account and each of its embedded Groups can independently configure a tax entry.
- Current tax properties remain supported:
  - `tax_included_rate`;
  - `tax_excluded_rate`;
  - `tax_description`.
- Established legacy properties remain supported during the parity migration:
  - `tax_rate`;
  - `tax_included`;
  - `tax_excluded`.
- Included tax is extracted from the source amount using the established aggregate included-rate and net-amount behavior.
- Excluded tax is calculated from the established net amount after included tax handling.
- `tax_included_amount` and `tax_excluded_amount` retain their existing fixed-amount override behavior.
- Tax amounts remain positive and retain the established rounding behavior from `tax_round` or the Book fraction digits.
- The established total included-rate limit remains unchanged.
- `tax_description` expressions retain their current substitution order, direction-sensitive behavior, and replacement semantics.
- Bkper continues to resolve the generated description into movement Accounts. Complete tax Transactions may affect balances; unresolved Transactions remain drafts.
- Generated tax Transactions retain date, remote id, eligible visible properties, and established exchange-property transformations.
- Remote ids retain the established `{taxTag}_{transactionId}_{accountOrGroupId}` shape, including the legacy `tax` tag normalization.
- Posted and restored source events retain their established batch-creation behavior and response strings.
- Deletion retains remote-id lookup, checked-state handling, uncheck-before-trash order, and current/previous Account discovery.
- Update retains its established relevant-change filter and delete-before-recreate order.
- Transactions created by Tax Bot and Exchange Bot retain their exact established skip behavior on each handler path.
- Unknown events, no-op paths, logging order, and success and error envelopes retain established behavior.

## Mechanical parity rules

These rules apply to every behavior-porting chunk:

- Preserve source class, method, and parameter names where practical.
- Preserve class decomposition, branch order, Account and Group traversal order, constructor timing, instance lifetime, return normalization, logging, API-call order, and side effects.
- Do not refactor, modernize, optimize, or clean up legacy tax behavior during the parity port.
- Do not use the README or general tax expectations to silently replace observed production behavior.
- Record code/documentation discrepancies as possible post-migration work, not migration requirements.
- Do not add production factories, registries, dependency injection, services, adapters, or testing hooks solely for testability.
- Keep test interception outside production architecture.
- Limit mechanical changes to runtime boundaries, module syntax, strict TypeScript requirements, request-scoped platform authentication, and build packaging.
- Compare legacy and target implementations side by side before completing each chunk.
- Record and explain every retained deviation.
- Stop and escalate any behavior that could create an incorrect posted movement, duplicate tax entry, missing tax entry, unintended balance effect, or data loss.

## Architecture

### Migration layout

During parity work, both implementations remained in the repository:

```text
tax-bot/
├── legacy/  # unchanged GCP implementation
└── new/     # isolated Cloudflare implementation
```

This made source comparison, production patch synchronization, independent verification, and rollback planning explicit.

The active app metadata under `legacy/` preserved the production GCP webhook until the production routing chunk. Developer routing moved to preview only after the corresponding review and approval.

### Consolidated layout

After accepted production stabilization, the Cloudflare project moved to the app root and the inactive GCP working-tree copy was removed:

```text
tax-bot/
├── AGENTS.md
├── ROADMAP.md
├── README.md
├── LICENSE
├── bkper.yaml
├── bun.lock
├── env.d.ts
├── package.json
├── tsconfig.json
└── server/
    ├── package.json
    ├── tsconfig.json
    ├── src/
    └── test/
```

The previous GCP source remains recoverable from Git history. The deployed GCP function remains active as a routing-only rollback target until a separate retirement plan is approved.

## Cloudflare runtime decisions

- Event-only Hono Worker with `/events`; no standalone health endpoint or unrelated public route.
- No client, public `/api/*`, OpenAPI contract, static assets, KV, secrets, or menu integration.
- Request-scoped `new Bkper()` without token, API-key, or agent providers.
- Platform outbound authentication supplies the event user's OAuth context and app agent identity.
- No reading or forwarding of `Authorization`, `bkper-oauth-token`, or `bkper-agent-id`.
- Strict TypeScript with no `as any` or inline dynamic imports.
- Bun package management with a committed lockfile.
- No Cloudflare bindings beyond the generated empty `Env` interface.
- Local Worker port `8794`; the obsolete local GCP port was removed during repository consolidation.

## Dependency compatibility decision

The Cloudflare target is pinned to `bkper-js` `2.19.0`.

Production uses `2.18.0`. Version `2.19.0` is the migration target because it provides the platform-compatible API endpoint while retaining the nullable missing-resource behavior needed for parity with the established SDK generation.

Tax-specific compatibility tests must characterize:

- `Amount` parsing, arithmetic, comparison, absolute-value, and rounding behavior;
- Book decimal separator and fraction-digit behavior;
- Account lookup, including previous Account ids during updates;
- Account payloads with embedded Groups;
- `batchCreateTransactions` serialization, ordering, and returned Transactions;
- description-based Account resolution and draft behavior;
- remote-id serialization and lookup;
- Transaction list first-match behavior;
- checked-state detection, uncheck, and trash operations;
- visible and hidden property filtering;
- API error and nullable-resource behavior used by normal control flow.

Any upgrade beyond `2.19.0` is separate post-migration work.

## Deterministic verification strategy

### Test boundary

Tests execute production handlers and real SDK models while intercepting only SDK or network boundaries. They require no credentials, deployment, network access, or live Book access.

Each behavior chunk follows this workflow:

1. Add the smallest failing test that describes current production behavior.
2. Add only the production method stub required by that behavior.
3. Implement enough behavior to pass.
4. Run focused tests.
5. Run the full deterministic gate.
6. Compare target and legacy implementations side by side.

### Behavior matrix

#### Event ingress and routing

- All four subscribed events reach their established handlers.
- `TRANSACTION_RESTORED` retains the posted-handler path.
- Unknown events preserve the established no-op response.
- Non-posted Transaction payloads preserve the established no-op response.
- Each request receives an isolated `Bkper` and app context.
- Platform code ignores legacy authentication headers.
- Success, array, false, included-rate-limit, and stack-array error responses preserve their established envelopes and status behavior.

#### Tax source discovery and loop prevention

- Origin and destination Accounts are processed in established order.
- Account properties are processed before embedded Group properties.
- Multiple Groups can produce multiple tax entries.
- Current and legacy property keys retain their lookup and precedence behavior.
- Missing, empty, zero, positive, and negative rates retain established behavior.
- Tax Bot and Exchange Bot skip checks remain on the same handler paths and inspect the same payload fields.
- Skip paths perform no Transaction or balance mutation.

#### Included and excluded calculations

- Aggregate included and excluded rates preserve Account and Group traversal semantics.
- Included tax uses the established aggregate formula and net-amount calculation.
- Excluded tax uses the established net amount.
- Fixed included and excluded amounts preserve their current matching and aggregation behavior.
- Mixed current and legacy properties retain established results.
- Tax amounts remain positive.
- The included-rate limit preserves its exact boundary and response.
- Default Book rounding and `tax_round` preserve valid, zero, negative, excessive, missing, and invalid-input behavior.
- Values are parsed with the Book decimal separator and fraction digits.
- No tax configuration preserves the no-op response.

#### Tax Transaction construction

- Each eligible tax property produces the established number of Transactions in the established order.
- Date, positive amount, generated description, remote id, and eligible source properties are preserved.
- Remote ids remain unique per tax property, source Transaction, and Account or Group.
- Legacy `tax_rate` retains the normalized `tax` remote-id tag.
- Every supported expression preserves current substitution order, side-sensitive expansion, empty-side expansion, and first-occurrence behavior.
- Hidden source properties remain hidden or excluded according to established `setVisibleProperty` behavior.
- Tax override and exchange calculation properties retain their established exclusion or transformation behavior.
- `exc_code`, `exc_date`, `exc_rate`, and `exc_amount` preserve their current branch order and zero fallback.
- A description resolving both Accounts produces one complete movement with one amount.
- A description failing to resolve either Account remains a non-balance-affecting draft.
- Batch creation preserves request order, response normalization, and result strings.
- Replayed source events do not create unintended duplicate posted tax entries.

#### Delete and restore lifecycle

- Deletion derives candidate remote ids from both current Accounts and their Groups.
- Previous origin and destination Account ids retain their established lookup behavior.
- Empty or missing tax properties retain established remote-id discovery behavior.
- Each candidate query uses the established remote-id form and first match.
- Checked linked Transactions are unchecked before trashing.
- Unchecked linked Transactions are trashed without an uncheck call.
- Missing linked Transactions remain no-ops.
- Restore preserves posted-handler calculation, batch creation, idempotency, and result behavior.

#### Update lifecycle

- Date, origin Account, destination Account, amount, included override, and excluded override changes trigger recalculation exactly as today.
- Irrelevant changes preserve the established explanatory no-op result.
- Fields not currently part of the relevant-change filter remain outside it during parity migration.
- Deletion completes before recreation begins.
- Deleted and posted response arrays preserve concatenation order.
- False, scalar, and array results retain established normalization.
- Previous Account ids are considered in the established order.
- Failures between deletion and recreation remain observable and replayable; migration work must not silently change this behavior.

### Local gate

The target root check will cover unit tests, strict production and test typechecks, Worker build, and formatting:

```bash
bun install --frozen-lockfile
bun run check
```

The gate performs no remote mutation.

## Production patch synchronization

While GCP remains production-authoritative, every production patch must be:

1. identified by behavior;
2. recorded in a small patch ledger;
3. characterized in a deterministic Cloudflare test;
4. ported when its behavior area is already implemented;
5. included in the next drift audit.

Repeat the drift audit before preview routing and immediately before production cutover.

### Patch ledger

| Legacy change | Production status | Cloudflare test | Cloudflare port | Notes |
| --- | --- | --- | --- | --- |
| _No legacy change after the accepted migration baseline_ | N/A | N/A | N/A | Tracked legacy source and configuration remain unchanged. |

## Migration chunks

Each chunk must be independently reviewable. All statuses remain planned until their gates are satisfied.

### Chunk 1 — Establish baseline and parallel layout

**Status: Complete.**

- Accepted the checked-in GCP source as the migration baseline after reviewing the deployed runtime artifact.
- Confirmed the `bkper-js` `2.18.0` production dependency baseline.
- Recorded the absence of deterministic legacy tests and a committed dependency lockfile without overstating coverage.
- Verified the legacy production build before relocation.
- Moved the unchanged GCP project into `legacy/` and reserved `new/` for the isolated Cloudflare target.
- Kept production and developer GCP webhook behavior unchanged.

**Gate:** The accepted GCP source is unchanged under `legacy/`, independently buildable, and remains the active production implementation.

### Chunk 2 — Create the minimal Cloudflare skeleton

**Status: Complete.**

- Added server-only workspace configuration, strict TypeScript, formatting, lockfile, and deployment metadata.
- Added a typed `/events` stub. The initial scaffold health route was later removed because it was not an application contract or migration gate.
- Assigned local Worker port `8794` and added it to workspace port forwarding while retaining the GCP development port.
- Preserved the production and developer GCP webhooks.

**Gate:** Three focused tests, production and test typechecks, formatting, and the Worker build pass with no app sync, deployment, routing change, or Book write.

### Chunk 3 — Port event ingress and dispatch

**Status: Complete.**

- Added typed event results and request-scoped app context.
- Reproduced the legacy event switch and response envelope.
- Added explicit handler stubs before business implementations.
- Confirmed platform code ignores legacy authentication headers.

**Gate:** Every subscribed event and unknown-event behavior is characterized deterministically, and the full local check passes without app sync, deployment, routing changes, or Book writes.

### Chunk 4 — Port common guards and tax source discovery

**Status: Complete.**

- Ported Transaction operation extraction, Book construction, and posted-state handling.
- Ported Tax Bot and Exchange Bot skip checks on their established paths.
- Ported origin/destination Account traversal and embedded Group traversal.
- Ported current and legacy tax-property lookup behavior.
- Ported remote-id construction helpers.

**Zero-sum gate:** Discovery and calculation selection perform no Transaction or balance mutation, and the full local check passes without credentials, network access, live Books, or Book writes.

### Chunk 5 — Port calculation and Transaction construction

**Status: Complete.**

- Ported aggregate included and excluded rate and fixed-amount behavior.
- Ported net-amount calculation, positive amount normalization, limit handling, and rounding.
- Ported tax-description expression expansion and direction-sensitive substitutions.
- Ported date, remote id, visible-property copying, and exchange-property transformations.
- Preserved construction and serialization order.

**Zero-sum gate:** Deterministic tests confirm entries that retain an amount use a positive amount and never assign a partial movement. The retained legacy rounded-zero path clears the amount and therefore remains a non-posted draft. Account resolution remains delegated to Bkper, so unresolved descriptions also remain drafts. The full local check passes without credentials, network access, live Books, or Book writes.

### Chunk 6 — Port posted and restored creation

**Status: Complete.**

- Ported posted-event behavior while retaining same-agent loop prevention.
- Ported creation for both source Accounts and all eligible Groups.
- Ported batch creation, returned Transaction handling, and response strings.
- Preserved restore routing through the established posted behavior.
- Characterized replay and remote-id idempotency at the deterministic SDK boundary.

**Gate:** Deterministic tests confirm one ordered batch request per eligible event, stable remote ids across posted replay and restore, established empty and returned-result handling, and no direct post request after creation. Simulated unresolved Account resolution remains a draft. The full local check passes with the network boundary intercepted and without credentials, live Books, or Book writes; live API idempotency remains part of preview validation.

### Chunk 7 — Port deletion

**Status: Complete.**

- Ported current Account and Group remote-id discovery.
- Ported previous origin and destination Account lookup.
- Ported linked Transaction query and first-match behavior.
- Preserved checked-state handling, uncheck-before-trash order, sequential API order, and response strings.

**Gate:** Deterministic tests confirm only first-match linked tax Transactions are trashed, checked entries are unchecked first, unchecked entries are trashed directly, missing matches remain no-ops, and the source movement is unchanged. Current and previous Account and Group discovery retains established ordering and missing previous Account behavior. The full local check passes with SDK mutation boundaries intercepted and without credentials, network access, live Books, or Book writes.

### Chunk 8 — Port update orchestration

**Status: Complete.**

- Ported the exact relevant-change filter.
- Preserved delete-before-recreate order.
- Preserved previous Account handling and result concatenation.
- Characterized failure behavior between deletion and recreation without redesigning it.

**Gate:** Deterministic tests confirm all established relevant fields trigger deletion then recreation, irrelevant and falsey changes preserve the explanatory no-op result without invoking either child handler, and absent previous attributes retain recalculation behavior. The same event and request context flow through both handlers, only array results are concatenated in deletion-before-posting order, and failures remain observable at their established point. The full local check passes with child handler boundaries intercepted and without credentials, network access, live Books, or Book writes.

### Chunk 9 — Full parity and drift audit

**Status: Complete.**

- Ran 77 deterministic tests across seven files with SDK and network boundaries intercepted. The matrix covers ingress, guards, source traversal, current and legacy properties, included and excluded calculations, fixed overrides, rounding, expression expansion, Transaction construction, batch creation, replay identifiers, deletion, restore, update orchestration, source immutability, and response envelopes.
- Added focused `bkper-js` `2.19.0` compatibility coverage for Amount arithmetic and comparison, Book parsing and rounding, the platform API endpoint, nullable missing-Account lookup, and observable non-404 API failures. Added explicit mixed included/excluded net-amount and positive `tax_round` coverage.
- Compared every target route and handler with its legacy counterpart. Branch order, constructor timing, Account and Group traversal, property precedence, formulas, movement construction, remote ids, SDK-call order, mutation boundaries, logging order, and result normalization remain aligned.
- Confirmed the tracked legacy source and configuration are unchanged from the accepted baseline and that no production patch was recorded after that baseline.
- Confirmed the target uses exact dependency versions and a frozen lockfile. The `bkper-js` `2.18.0` to `2.19.0` package comparison found no declaration or domain-model changes; the implementation difference is isolated to the HTTP boundary for platform proxy selection and generic error logging.
- Confirmed the target `bkper.yaml` preserves legacy identity, production GCP webhook, event subscriptions, and property schema while adding only Worker deployment metadata. The generated `Env` remains empty.
- Inspected a clean Worker build. The application registers only `POST /events`; the bundle contains the expected Hono, `bkper-js` `2.19.0`, Big.js, Luxon, and UUID runtime code, with no client, static assets, KV, secrets, or app-defined authentication provider.
- Rebuilt the legacy target successfully. Because the accepted legacy project intentionally has no lockfile and declares a dependency range, this remains buildability evidence rather than deterministic production-dependency evidence.

**Retained runtime-boundary deviations:**

- Hono replaces Express, Functions Framework, request-local HTTP context, environment API-key loading, and inbound authentication-header providers. The Worker creates one provider-free `Bkper` per request so platform outbound authentication can supply identity. The removed `AppContext` key/value methods had no legacy business caller.
- Strict TypeScript adds type-only non-null assertions, `unknown` error narrowing, and test-visible protected methods. These do not alter emitted business branches. The error narrowing preserves established Error stack arrays and direct non-Error values while avoiding a secondary catch-block failure for exotic null or non-string-stack throws; no subscribed legacy path intentionally throws those values.
- `bkper-js` `2.19.0` selects `https://api.bkper.app` when no API key is configured and logs the original generic SDK error value rather than only its message. Tax models, serialization, nullable 404 handling, arithmetic, and SDK method behavior are unchanged from `2.18.0`.
- YAML formatting and generated Worker packaging differ mechanically from GCP packaging; the application metadata and tax behavior do not.

**Gate:** No unexplained difference remains in rate selection, formula, amount, rounding, movement resolution, traversal order, remote ids, state transitions, API-call order, resource mutation, or response behavior.

### Chunk 10 — Preview readiness and first canary

**Status: Complete.**

- Passed the full local candidate gate with 77 deterministic tests, strict production and test typechecks, a clean Worker build, and formatting.
- Deployed the reviewed server-only candidate to preview and routed developer events to it while retaining the production GCP webhook unchanged.
- Created one private synthetic Book with isolated Asset, Incoming, and Liability Accounts, configured one 10% included-tax rule, and installed Tax Bot for preview event delivery.
- Posted one low-value complete source movement. Canonical re-reads found exactly the unchanged source and one generated complete tax movement with the expected positive amount, direction, state, Tax Bot attribution, and remote id.
- Deterministic per-Account movement aggregation produced an exact zero sum. No duplicate, reversal, partial posting, source mutation, or unexplained balance effect was found.
- Confirmed authenticated preview handling with a successful event response. The generated Tax Bot event produced no recursive bot response.
- Recorded two inherited non-accounting behaviors found during the canary—the optional formatted date missing from an informational result and numeric text consumed by Bkper description parsing—in [`BUGS.md`](./BUGS.md) for post-stabilization review.

**Gate:** Passed. Preview handled one complete tax movement without a duplicate, reversal, partial posting, unintended source mutation, or unexplained balance effect.

### Chunk 11 — Deterministic preview validation

**Status: Complete.**

- Exercised included and excluded tax on both movement sides with exact positive amounts, directions, classifications, and net movement assertions.
- Exercised Account, Group, and multiple-Group configuration, including two independently linked Group taxes on one source movement.
- Exercised fixed included and excluded overrides, custom rounding, all established legacy property forms, and origin- and destination-sensitive expression variants.
- Verified an unresolved tax Account produced one linked draft with no tax balance effect.
- Exercised update no-op and amount-recalculation paths, unchecked and checked linked-entry deletion, restoration, and replay idempotency. Checked deletion produced the required check, uncheck, then trash lifecycle order.
- Verified Tax Bot and Exchange Bot loop-prevention paths produced no recursive tax Transaction.
- Exercised a bounded 20-Group fixture. Creation produced exactly 20 complete linked tax movements, and sequential deletion removed all 20 without a timeout or partial result.
- Re-read canonical Transactions and Events after every scenario and applied deterministic per-Account movement aggregation. The final audit found 33 active posted Transactions and one intentional unresolved draft across the Chunk 11 range, 17 unique active tax remote ids, complete lifecycle evidence, and an exact aggregate zero sum.
- Found no preview error Event or error-level preview log during the validation window. The full local gate still passes with 77 deterministic tests, strict production and test typechecks, a clean Worker build, and formatting; the legacy build also remains successful.

**Gate:** Passed. Automated assertions and human review found no duplicate, missing, reversed, partial, imbalanced, incorrectly rounded, or incorrectly classified tax movement.

### Chunk 12 — Final drift audit and production deployment

**Status: Complete.**

- Repeated the production-source drift audit. The tracked legacy source and configuration remain unchanged since the accepted baseline, and no target production source changed after the completed parity audit.
- Performed a clean frozen install and passed the full target gate with 77 deterministic tests, strict production and test typechecks, a clean Worker build, and formatting.
- Reconfirmed that the production artifact registers only `POST /events`, uses no legacy inbound authentication provider, and declares no secrets or platform services.
- Rebuilt the legacy target successfully while retaining its documented dependency-range and missing-lockfile verification limitation.
- Deployed the accepted artifact to production Cloudflare without syncing app metadata. The persisted production webhook continues to route events to GCP, developer events continue to route to preview, and the retained GCP deployment remains unchanged.
- Confirmed production deployment status and log-query availability. No production Worker request was generated as part of this deployment-only chunk, so no production request log was expected or found.

**Gate:** Passed. Deployment changed runtime availability only; production event routing and rollback remain unchanged.

### Chunk 13 — Production webhook cutover

**Status: Complete.**

- Changed only the persisted production webhook route from GCP to production Cloudflare. Developer routing remains on preview, and the GCP deployment remains active and unchanged for immediate routing rollback.
- Verified the persisted production and developer routes and the unchanged production deployment after the sync.
- Monitored a 60-minute production window with 61 event requests: 30 posted and 31 updated. Every request completed with HTTP 200; no non-200 response, error-level request, or error envelope occurred.
- Observed three requests with generated-tax result arrays plus established no-op and Exchange Bot loop-prevention paths. Provider-free SDK warnings matched established preview behavior and were not accompanied by an authentication failure.
- Received no customer-impact report during the active window. No restored or deleted event occurred naturally, numeric latency was not exposed by the log interface, and no customer Book or balance was inspected; those limitations remain explicit for stabilization.

**Rollback triggers:** suspected zero-sum or data-loss issues, incorrect tax amounts, reversed or incomplete movements, duplicate or missing tax entries, failed update replacement, sustained authentication failures, material latency or error growth, or missing production behavior.

**Gate:** Passed. The active window produced no technical or reported rollback trigger, and GCP remains available for immediate routing rollback.

### Chunk 14 — Stabilization

**Status: Complete.**

- The owner accepted stabilization after approximately 22 hours of observed production traffic rather than waiting for a full 24-hour interval.
- Queried production deployment status and paginated `/events` logs read-only across a fixed 24-hour window that began before the production deployment. The window contained 14,168 requests: 8,972 posted, 647 updated, 4,548 deleted, and one restored event. Every request completed with HTTP 200 and an `ok` outcome; no error-level request or error response envelope was found.
- Observed two high-volume hours with 5,185 and 6,202 event requests without a non-200 response. One transient upstream 502 was retried successfully within a request that completed with HTTP 200.
- Production responses reported 281 tax creations across 260 requests and 85 linked-tax deletions across 76 requests. Sixty-eight update requests reported delete-then-recreate results, providing production lifecycle evidence without a log-visible failed replacement.
- The single restored event was a no-op and therefore did not independently demonstrate restored tax recreation in production. No synthetic production write was run; accepted deterministic and preview restore evidence remains the basis for that path.
- No customer Book, Transaction, movement, or balance was inspected. Production logs alone do not prove exact tax amounts, movement completeness, idempotency, or zero sum, so the accepted deterministic and preview evidence remains the accounting-safety basis.
- Recorded inherited production observability issues in [`BUGS.md`](./BUGS.md): all 281 observed creation-result entries lacked a formatted date, generated Transaction properties were emitted to runtime logs, and provider-free SDK calls produced high-volume warning noise without an authentication failure.
- A fresh production tail after the fixed query window continued to show successful HTTP 200 event handling and no error response.

**Gate:** Passed by explicit owner acceptance. The combined deterministic, preview, cutover, and shortened production-observation evidence produced no log-visible rollback trigger, with the unavailable production accounting evidence and ineffective restored-event sample retained as explicit limitations.

### Chunk 15 — Repository consolidation and deferred GCP retirement

**Status: Repository consolidation complete; infrastructure retirement deferred.**

- Moved the Cloudflare project from `new/` to the `tax-bot/` root.
- Removed the inactive `legacy/` working-tree copy and obsolete local GCP tooling.
- Removed the legacy local GCP port and documented Worker port `8794` at the consolidated path.
- Ran the full deterministic gate before and after the move and confirmed the built Worker bundle remained byte-for-byte identical.
- Preserved the previous GCP source in Git history.
- Kept the unchanged GCP deployment available as a routing-only rollback target.

**Outcome:** Cloudflare is the only active implementation in the project root. No app sync, deployment, routing change, GCP mutation, or Book write occurred during repository consolidation.

## Rollback strategy

The retained GCP deployment can receive production events again through a config-only webhook change.

During rollback:

1. stop and identify the trigger;
2. restore the retained GCP endpoint in app metadata;
3. review the exact configuration diff and remote sync command;
4. obtain explicit approval before syncing;
5. confirm persisted routing and inspect event handling;
6. keep Cloudflare deployed for incident analysis;
7. reconcile any source Transactions whose tax deletion or recreation may have been interrupted.

The active repository will no longer contain a GCP deployment project after consolidation. Rebuilding the retained deployment requires recovering the legacy source from Git history and a separate reviewed incident action.

## Completion definition

### Application migration — complete

- Cloudflare handles production events.
- Subscribed behavior has deterministic parity coverage.
- Tax formulas, movement direction, amount, rounding, idempotency, lifecycle, and zero-sum checks pass.
- Preview, cutover, and stabilization gates passed.
- The Cloudflare app occupies the project root.
- GCP remains available for routing rollback.

### Infrastructure retirement — deferred

Deleting the retained GCP deployment, source artifacts, IAM bindings, or related infrastructure requires a future plan and explicit approval. Time elapsed alone is not a retirement criterion.

## Optional post-migration work

### Legacy behavior and documentation review

Review known code/documentation discrepancies only after migration parity is accepted. Candidate areas include update-trigger fields, legacy fixed-amount behavior, exchange-property descriptions, removed tax-property cleanup, expression replacement semantics, and rounded-zero handling.

Each change must begin with tests for accepted migrated behavior and include explicit tax and balance expectations.

### Update lifecycle resilience

Delete-before-recreate behavior can leave linked tax entries trashed if recreation fails. Any retry, transactional, or recovery redesign is a separate behavior change requiring deterministic failure tests, replay semantics, and Book evidence.

### SDK modernization

Upgrading beyond `bkper-js` `2.19.0` is not a migration completion gate.

Before adopting newer error or resource-loading semantics:

- characterize missing Account and Transaction lookup used as normal control flow;
- keep authentication, permission, network, and server failures observable;
- verify Amount, batch creation, description parsing, and property serialization behavior;
- validate the upgrade through preview and deterministic Book evidence as an independent behavior change.

### Boundary and response hardening

Malformed event validation, safer error responses, explicit failure statuses, and logging or timeout improvements remain separate from migration parity.

Any such change must prove that valid events, tax movements, balances, idempotency, and the zero-sum invariant remain unaffected.
