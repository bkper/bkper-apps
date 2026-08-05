# Tax Bot: GCP to Cloudflare Migration Roadmap

## Status

**Chunks 1–2 complete.** The accepted GCP source baseline remains unchanged under `legacy/`, and a minimal server-only Cloudflare skeleton now exists under `new/`. Business behavior has not been ported, and no deployment, routing, or Book mutation has begun.

The existing Google Cloud Function remains the active production implementation. The initial migration target is an isolated Bkper Platform application on Cloudflare Workers. Deployment, developer routing, production routing, stabilization, repository consolidation, and GCP retirement are separate decisions.

## Purpose of this document

This roadmap adapts the completed Subledger Bot migration process to Tax Bot. It reuses the proven migration structure while replacing Subledger-specific consolidation assumptions with Tax Bot's calculation, movement, lifecycle, and loop-prevention behavior.

This is a public, community-facing roadmap. It records technical decisions and reproducible outcomes without retaining raw operational logs, Book or resource identifiers, internal infrastructure identifiers, personal names, or routine approval chronology.

## Objective

Migrate the published `sales-tax-bot` app from Google Cloud Functions to the Bkper Platform on Cloudflare Workers without intentionally changing its business behavior.

The Cloudflare implementation will run in parallel with the GCP implementation until deterministic parity and live canaries pass. The GCP implementation remains authoritative until production event routing is explicitly cut over.

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

During parity work, both implementations remain in the repository:

```text
tax-bot/
├── legacy/  # unchanged GCP implementation
└── new/     # isolated Cloudflare implementation
```

This makes source comparison, production patch synchronization, independent verification, and rollback planning explicit.

The active app metadata under `legacy/` must preserve the production GCP webhook until the production routing chunk. Developer routing may move to preview only after the corresponding review and approval.

### Intended post-stabilization layout

After accepted production stabilization, the Cloudflare project moves to the app root and the inactive GCP working-tree copy is removed:

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

- Event-only Hono Worker with `/health` and `/events`.
- No client, public `/api/*`, OpenAPI contract, static assets, KV, secrets, or menu integration.
- Request-scoped `new Bkper()` without token, API-key, or agent providers.
- Platform outbound authentication supplies the event user's OAuth context and app agent identity.
- No reading or forwarding of `Authorization`, `bkper-oauth-token`, or `bkper-agent-id`.
- Strict TypeScript with no `as any` or inline dynamic imports.
- Bun package management with a committed lockfile.
- No Cloudflare bindings beyond the generated empty `Env` interface.
- Local Worker port `8794` while the GCP development port remains available during parallel work.

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
| _Populate during migration_ |  |  |  |  |

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
- Added `/health` and a typed `/events` stub.
- Assigned local Worker port `8794` and added it to workspace port forwarding while retaining the GCP development port.
- Preserved the production and developer GCP webhooks.

**Gate:** Three focused tests, production and test typechecks, formatting, and the Worker build pass with no app sync, deployment, routing change, or Book write.

### Chunk 3 — Port event ingress and dispatch

**Status: Planned.**

- Add typed event results and request-scoped app context.
- Reproduce the legacy event switch and response envelope.
- Add explicit handler stubs before business implementations.
- Confirm platform code ignores legacy authentication headers.

**Gate:** Every subscribed event and unknown-event behavior is characterized deterministically.

### Chunk 4 — Port common guards and tax source discovery

**Status: Planned.**

- Port Transaction operation extraction, Book construction, and posted-state handling.
- Port Tax Bot and Exchange Bot skip checks on their established paths.
- Port origin/destination Account traversal and embedded Group traversal.
- Port current and legacy tax-property lookup behavior.
- Port remote-id construction helpers.

**Zero-sum gate:** Discovery and calculation selection perform no Transaction or balance mutation.

### Chunk 5 — Port calculation and Transaction construction

**Status: Planned.**

- Port aggregate included and excluded rate and fixed-amount behavior.
- Port net-amount calculation, positive amount normalization, limit handling, and rounding.
- Port tax-description expression expansion and direction-sensitive substitutions.
- Port date, remote id, visible-property copying, and exchange-property transformations.
- Preserve construction and serialization order.

**Zero-sum gate:** Each constructed tax entry has one amount; only entries with two resolved Accounts may affect balances, and unresolved entries remain drafts.

### Chunk 6 — Port posted and restored creation

**Status: Planned.**

- Port posted-event behavior and same-agent loop prevention.
- Port creation for both source Accounts and all eligible Groups.
- Port batch creation, returned Transaction handling, and response strings.
- Route restore through the established posted behavior.
- Characterize replay and remote-id idempotency.

**Gate:** No duplicate, missing, reversed, partial, or unexpectedly posted tax movement remains unexplained.

### Chunk 7 — Port deletion

**Status: Planned.**

- Port current Account and Group remote-id discovery.
- Port previous origin and destination Account lookup.
- Port linked Transaction query and first-match behavior.
- Preserve checked-state handling, uncheck-before-trash order, sequential API order, and response strings.

**Gate:** Deletion affects only linked tax Transactions and never mutates the source movement.

### Chunk 8 — Port update orchestration

**Status: Planned.**

- Port the exact relevant-change filter.
- Preserve delete-before-recreate order.
- Preserve previous Account handling and result concatenation.
- Characterize failure behavior between deletion and recreation without redesigning it.

**Gate:** Relevant updates recalculate deterministically; irrelevant updates perform no tax or balance mutation.

### Chunk 9 — Full parity and drift audit

**Status: Planned.**

- Run the complete deterministic behavior matrix.
- Compare every target handler with its legacy counterpart.
- Review dependency versions, configuration, generated artifacts, and bundle contents.
- Confirm no production patch is missing.
- Explain every runtime-boundary deviation.

**Gate:** No unexplained difference remains in rate selection, formula, amount, rounding, movement resolution, traversal order, remote ids, state transitions, API-call order, resource mutation, or response behavior.

### Chunk 10 — Preview readiness and first canary

**Status: Planned.**

- Build and review the preview candidate before enabling developer routing.
- Deploy preview without changing production routing.
- Use a synthetic Book for one isolated, low-value tax calculation canary.
- Start with one complete included-tax movement and verify its source and generated movement deterministically.
- Confirm preview health, authenticated event handling, expected remote id, and exact movement evidence.

**Gate:** Preview handles one complete tax movement without a duplicate, reversal, partial posting, unintended source mutation, or unexplained balance effect.

### Chunk 11 — Deterministic preview validation

**Status: Planned.**

- Exercise included and excluded tax on both movement sides.
- Exercise Account, Group, and multiple-Group configuration.
- Exercise fixed overrides, rounding, legacy properties, and expression variants.
- Exercise update no-op and recalculation paths, deletion, checked linked entries, restoration, and replay.
- Exercise Tax Bot and Exchange Bot loop-prevention paths.
- Verify unresolved Account parsing remains a draft with no balance effect.
- Include a bounded high-fan-out fixture to expose Worker latency or sequential deletion limits hidden by the previous GCP timeout.
- Use deterministic pre/post Transaction and balance assertions with explicit expected values derived from the fixture.

**Gate:** Automated assertions and human review find no duplicate, missing, reversed, partial, imbalanced, incorrectly rounded, or incorrectly classified tax movement.

### Chunk 12 — Final drift audit and production deployment

**Status: Planned.**

- Repeat the production-source drift audit.
- Build the production artifact from a clean frozen install.
- Deploy the accepted artifact to production Cloudflare while events still route to GCP.
- Confirm production health and log availability.

**Gate:** Deployment changes runtime availability only; production event routing and rollback remain unchanged.

### Chunk 13 — Production webhook cutover

**Status: Planned.**

- Change only the production webhook route.
- Keep developer routing on preview.
- Monitor Cloudflare requests, handler responses, authentication, errors, latency, and customer-impact reports during the active window.
- Keep GCP active and unchanged for immediate routing rollback.

**Rollback triggers:** suspected zero-sum or data-loss issues, incorrect tax amounts, reversed or incomplete movements, duplicate or missing tax entries, failed update replacement, sustained authentication failures, material latency or error growth, or missing production behavior.

### Chunk 14 — Stabilization

**Status: Planned.**

- Continue read-only production log and event monitoring.
- Verify representative posted, restored, updated, and deleted traffic when available.
- Run explicitly approved synthetic production-routing checks for complete and unresolved tax movements.
- Confirm exact amount, direction, remote id, state, and expected deterministic balance effect.
- Use accepted deterministic and preview evidence for event paths that do not naturally occur during the observation window.
- Record production-coverage limitations instead of claiming unavailable customer Book or balance inspection.

**Gate:** The owner accepts the observation period and combined evidence without a rollback trigger.

### Chunk 15 — Repository consolidation and deferred GCP retirement

**Status: Planned.**

- Move the Cloudflare project from `new/` to the `tax-bot/` root.
- Remove the inactive `legacy/` working-tree copy and obsolete local GCP tooling.
- Replace the GCP local port with Worker port `8794` in workspace instructions and port forwarding.
- Verify source, tests, lockfile, configuration, and built Worker behavior remain unchanged through the move.
- Preserve the previous GCP source in Git history.
- Keep the unchanged GCP deployment available as a routing-only rollback target.

**Gate:** Cloudflare is the only active implementation in the project root. Consolidation performs no app sync, deployment, routing change, GCP mutation, or Book write.

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

### Application migration

Complete only when:

- Cloudflare handles production events.
- Subscribed behavior has deterministic parity coverage.
- Tax formulas, movement direction, amount, rounding, idempotency, lifecycle, and zero-sum checks pass.
- Preview, cutover, and stabilization gates pass.
- The Cloudflare app occupies the project root.
- GCP remains available for routing rollback.

### Infrastructure retirement

Not part of application migration completion.

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
