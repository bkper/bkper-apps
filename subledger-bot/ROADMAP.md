# Subledger Bot: GCP to Cloudflare Migration Roadmap

## Status

**The Cloudflare application migration and repository consolidation are complete. GCP retirement is intentionally deferred.**

Production and developer events route to the Cloudflare Workers. The previous GCP deployment remains active and unchanged as a routing-only rollback target. The Cloudflare implementation passed deterministic parity checks, preview canaries, production cutover monitoring, and stabilization without a rollback trigger.

## Purpose of this document

Subledger Bot is the first Bkper bot migrated from Google Cloud Functions to the Bkper Platform on Cloudflare Workers. This roadmap records the migration approach so it can serve as a starting point for later bot migrations.

Reuse the process, not the bot-specific assumptions. Each migration must redefine its own:

- domain behavior and safety invariants;
- event subscriptions and loop-prevention rules;
- dependency compatibility requirements;
- deterministic behavior matrix;
- preview canaries and production evidence;
- rollback and retirement strategy.

This is a public, community-facing roadmap. It intentionally records technical decisions and reproducible outcomes without retaining raw operational logs, Book or resource identifiers, internal infrastructure identifiers, personal names, or approval chronology.

## Objective

Migrate the published `subledger-bot` app to Cloudflare without intentionally changing its business behavior.

The Cloudflare implementation ran in parallel with the GCP implementation until deterministic parity and live canaries passed. Deployment, event routing, stabilization, repository consolidation, and infrastructure retirement were treated as separate decisions.

## Non-negotiable invariants

1. **Protect Bkper's zero-sum invariant above all else.** Every consolidated posted transaction must remain one complete movement from a mapped origin Account to a mapped destination Account for the same amount.
2. **Unresolved movements remain drafts.** An incomplete parent transaction must not affect balances.
3. **Migration parity comes first.** Do not combine an infrastructure migration with intentional business-logic fixes, redesigns, or feature work.
4. **The existing production implementation remains authoritative until cutover.** Any production patch during migration must be translated into a deterministic test and the Cloudflare implementation.
5. **Implementation tests never write to live Books.** Use unit tests with controlled SDK and network boundaries.
6. **Deployment and routing are separate.** A deployed Worker does not imply that production events should route to it.
7. **Remote mutations require explicit approval.** App sync, deploy, install, replay, and Book-write operations must be reviewed separately.
8. **Keep changes small and reviewable.** Prefer independently mergeable chunks over a long-running rewrite.

## Domain behavior preserved

Subledger Bot connects child Books to a parent Book and consolidates complete child movements into the parent.

- Child transaction ids become parent transaction remote ids for idempotent lookup.
- `child_from` and `child_to` preserve the original child Account names.
- Visible transaction, Account, and Group properties are copied; hidden properties are not.
- `parent_amount` can override the parent amount; the established zero behavior remains unchanged.
- Parent Account resolution preserves this order:
  1. `parent_account` on the child Account;
  2. `parent_account` on a child Account Group, including established auto-creation behavior;
  3. same-name mapping through a Group linked by `child_book_id`;
  4. same-name parent Account fallback.
- Parent-to-child Account and Group synchronization is driven by `child_book_id`.
- Child Group-to-parent Account synchronization is driven by `parent_account`.
- Posted, checked, updated, deleted, and restored transaction state transitions preserve their existing order.
- Exchange Bot events and transactions continue to use the established skip checks.

## Mechanical parity rules

These rules applied to every behavior-porting chunk:

- Preserve source class, method, and parameter names where practical.
- Preserve class decomposition, branch order, lookup order, constructor timing, instance lifetime, return normalization, logging, API-call order, and side effects.
- Do not refactor, modernize, optimize, or clean up legacy behavior during the parity port.
- Do not add production factories, registries, dependency injection, services, adapters, or testing hooks solely for testability.
- Keep test interception outside production architecture.
- Limit mechanical changes to runtime boundaries, module syntax, strict TypeScript requirements, request-scoped platform authentication, and build packaging.
- Compare legacy and target implementations side by side before completing each chunk.
- Record and explain every retained deviation.
- Stop and escalate any behavior that could violate zero-sum integrity or cause data loss.

## Architecture

### Historical migration layout

During parity work, the repository temporarily kept both implementations:

```text
subledger-bot/
├── legacy/  # GCP implementation
└── new/     # Cloudflare implementation
```

This made source comparison, patch synchronization, independent verification, and rollback planning explicit.

### Current layout

After production stabilization, the Cloudflare project moved to the app root and the inactive GCP working-tree copy was removed:

```text
subledger-bot/
├── AGENTS.md
├── ROADMAP.md
├── README.md
├── LICENSE
├── bkper.yaml
├── bun.lock
├── package.json
├── tsconfig.json
└── server/
    ├── package.json
    ├── tsconfig.json
    ├── src/
    └── test/
```

The previous GCP source remains recoverable from Git history. The deployed GCP function remains active only for routing rollback.

## Cloudflare runtime decisions

- Event-only Hono Worker with `/events`; no standalone health endpoint or unrelated public route.
- No client, public `/api/*`, OpenAPI contract, static assets, KV, secrets, or menu integration.
- Request-scoped `new Bkper()` without token, API-key, or agent providers.
- Platform outbound authentication supplies the event user's OAuth context and app agent identity.
- No reading or forwarding of `Authorization`, `bkper-oauth-token`, or `bkper-agent-id`.
- Strict TypeScript with no `as any` or inline dynamic imports.
- Bun package management with a committed lockfile.
- No Cloudflare bindings beyond the generated empty `Env` interface.
- Local Worker port `8790`.

## Dependency compatibility decision

The migration target remains pinned to `bkper-js` `2.19.0`.

The GCP deployment used a version where missing-resource HTTP 404 responses were normalized to `null`. Later SDK versions intentionally propagated those errors. The migration needed both the established nullable-404 behavior and the platform-authenticated API endpoint, making `2.19.0` the smallest compatible target.

This pin is a behavior-compatibility decision, not general upgrade guidance. SDK modernization remains separate post-migration work.

## Deterministic verification strategy

### Test boundary

Tests execute production handlers and real SDK models while intercepting only SDK or network boundaries. They require no credentials, deployment, or live Book access.

Each behavior chunk follows this workflow:

1. Add the smallest failing test that describes current production behavior.
2. Add only the production method stub required by that behavior.
3. Implement enough behavior to pass.
4. Run focused tests.
5. Run the full deterministic gate.
6. Compare target and legacy implementations side by side.

### Behavior matrix

#### Event ingress and routing

- Every subscribed event reaches the matching handler.
- Unknown events preserve the established no-op response.
- Parent and child Books are distinguished using `parent_book_id` and the legacy fallback.
- Parent-side transaction events remain no-ops.
- Exchange Bot skip behavior remains unchanged.
- Response and error envelopes preserve established behavior.

#### Transaction movements and state

- A parent transaction preserves date, amount, description, visible properties, remote id, and trace properties.
- Child origin maps to parent origin; child destination maps to parent destination.
- One Transaction carries one amount and both movement sides.
- Complete movements post; unresolved movements remain drafts.
- Account mapping strategies retain their established priority.
- Group-based parent Account auto-creation remains unchanged.
- `parent_amount`, including zero behavior, remains unchanged for each path.
- Existing remote-id matches prevent duplicate creation.
- Update preserves movement direction, properties, URLs, and file URLs.
- Checked transactions are unchecked before established mutations.
- Delete trashes and restore untrashes the connected transaction.

#### Account synchronization

- Parent Account create and update synchronize to the selected child Book.
- Name, type, visible properties, archived state, and eligible Group membership are preserved.
- Rename fallback through previous attributes remains unchanged.
- Delete-versus-archive behavior remains unchanged.
- Child-side Account events remain no-ops.
- Account handlers do not create transaction or balance movements.

#### Group synchronization

- Parent Group create, update, and delete synchronize through `child_book_id`.
- `child_book_id` is not copied into the child Group.
- Rename lookup through previous attributes remains unchanged.
- Child Group events manage parent Accounts only when `parent_account` is present.
- Existing no-op and Exchange Bot skip paths remain unchanged.

### Local gate

From `subledger-bot/`:

```bash
bun install --frozen-lockfile
bun run check
```

The check covers unit tests, strict production and test typechecks, Worker build, and formatting. It performs no remote mutation.

## Production patch synchronization

While GCP was production-authoritative, every legacy patch had to be:

1. identified by behavior;
2. characterized in a deterministic Cloudflare test;
3. ported when its behavior area was already implemented;
4. included in the next drift audit.

No legacy behavior drift was found during this migration. Future migrations should keep a small patch ledger and repeat the drift audit before preview routing and immediately before cutover.

## Migration chunks

Each chunk below was independently reviewable. This sequence is the recommended starting point for later GCP bot migrations, adjusted for their domain behavior.

### Chunk 1 — Establish baseline and parallel layout

**Status: Complete.**

- Recorded the production source baseline and verification outcome.
- Moved the GCP project into `legacy/` without behavior changes.
- Established `new/` as the isolated Cloudflare target.
- Documented which implementation remained production-authoritative.

**Gate:** The relocated GCP implementation remained equivalent and independently buildable.

### Chunk 2 — Create the minimal Cloudflare skeleton

**Status: Complete.**

- Added server-only workspace configuration, strict TypeScript, formatting, lockfile, and deployment metadata.
- Added a typed `/events` stub. The initial scaffold health route was later removed because it was not an application contract or migration gate.
- Assigned an explicit local Worker port.
- Preserved the production GCP webhook.

**Gate:** Tests, typecheck, formatting, and Worker build passed with no app sync, deployment, or Book write.

### Chunk 3 — Port event ingress and dispatch

**Status: Complete.**

- Added typed event results and request-scoped app context.
- Reproduced the legacy event switch and response envelope.
- Added explicit handler stubs before business implementations.
- Confirmed platform code ignored legacy authentication headers.

**Gate:** Every subscribed event and unknown-event behavior was characterized deterministically.

### Chunk 4 — Port Book direction and Account mapping

**Status: Complete.**

- Ported parent and child Book resolution.
- Ported Book anchors, response formatting, and Exchange Bot event skips.
- Ported Account mapping in its established priority order.
- Preserved Group-based parent Account auto-creation and fallback semantics.

**Zero-sum gate:** Mapping selects Accounts but never independently creates a transaction side or amount.

### Chunk 5 — Port posted and checked transaction creation

**Status: Complete.**

- Ported posted and checked event behavior.
- Preserved remote-id idempotency, movement direction, visible and trace properties, amount override, posting, drafting, and checking.
- Preserved established response strings and no-op branches.

**Zero-sum gate:** Complete transactions contain both mapped Accounts and one amount; unresolved transactions remain non-balance-affecting drafts.

### Chunk 6 — Port transaction update, delete, and restore

**Status: Complete.**

- Ported update, delete, and restore behavior.
- Preserved checked-state handling, URLs, file URLs, trashed queries, and result strings.
- Preserved the established `parent_amount` zero update behavior.

**Gate:** Tests protected uncheck-before-mutation order, trash and untrash transitions, and movement direction.

### Chunk 7 — Port Account synchronization

**Status: Complete.**

- Ported Account create, update, rename, delete, and archive behavior.
- Preserved parent-to-child direction and child Book selection.
- Preserved visible properties, archived state, and linked Group membership.

**Gate:** Account handlers made no transaction or balance mutation.

### Chunk 8 — Port Group synchronization

**Status: Complete.**

- Ported Group create, update, rename, and delete in both established directions.
- Preserved removal of `child_book_id` from copied Groups.
- Preserved child Group `parent_account` behavior for managing parent Accounts.

**Gate:** Relationship-free events and Exchange Bot events retained their no-op behavior.

### Chunk 9 — Full parity and drift audit

**Status: Complete.**

- Ran the complete deterministic behavior matrix.
- Compared every target handler with its legacy counterpart.
- Reviewed dependency versions, configuration, generated artifacts, and bundle contents.
- Confirmed no production patch was missing.

**Gate:** No unexplained difference remained in movement direction, amount, lookup order, state transitions, API-call order, resource mutation, or response behavior.

### Chunk 10 — Preview readiness and first canary

**Status: Complete.**

- Built and reviewed the preview candidate before enabling developer routing.
- Deployed preview without changing production routing.
- Used synthetic parent and child Books for an isolated Group synchronization canary.
- Detected an SDK missing-resource semantic mismatch before production.
- Resolved it through the migration-compatible SDK pin without changing handler architecture.

**Gate:** Authenticated preview event handling, expected resource creation, and zero-movement evidence passed.

### Chunk 11 — Deterministic preview validation

**Status: Complete.**

- Exercised representative Group, Account, and transaction paths.
- Covered same-name non-permanent mapping and many-to-one permanent mapping.
- Verified exactly one parent remote-id match for a complete consolidation.
- Verified movement direction, amount, state, and visible and trace properties.
- Verified unresolved mapping created a draft with no balance effect.

**Gate:** Deterministic assertions and human review found no duplicate, missing, reversed, partial, or imbalanced posted movement.

### Chunk 12 — Final drift audit and production deployment

**Status: Complete.**

- Repeated the production-source drift audit.
- Built the production artifact from a clean frozen install.
- Deployed the accepted artifact to production Cloudflare while events still routed to GCP.
- Confirmed production deployment and log availability.

**Gate:** Deployment changed runtime availability only; production event routing and rollback remained unchanged.

### Chunk 13 — Production webhook cutover

**Status: Complete.**

- Changed only the production webhook route.
- Kept developer routing on preview.
- Monitored Cloudflare requests, handler responses, authentication, errors, and customer-impact reports during the active window.
- Kept GCP active and unchanged for immediate rollback.

**Rollback triggers:** suspected zero-sum or data-loss issues, reversed movements, duplicate consolidation, sustained authentication failures, material error growth, or missing production behavior.

**Outcome:** Production traffic moved to Cloudflare without a rollback trigger.

### Chunk 14 — Stabilization

**Status: Complete.**

- Continued read-only production log and event monitoring.
- Verified representative transaction and Account traffic.
- Ran synthetic production-routing checks for Account synchronization and a complete consolidated movement.
- Confirmed one complete parent remote-id match with preserved direction, amount, and trace properties.
- Confirmed unresolved mapping remained a draft.
- Used accepted deterministic and preview evidence for event paths that did not naturally occur during the production observation.
- Recorded production-coverage limitations instead of claiming unavailable customer Book or balance inspection.

**Outcome:** The owner accepted the observed production volume and combined evidence. Stabilization ended without migration-related errors, customer reports, or a rollback trigger.

### Chunk 15 — Repository consolidation and deferred GCP retirement

**Status: Repository consolidation complete; infrastructure retirement deferred.**

- Moved the Cloudflare project from `new/` to the `subledger-bot/` root.
- Removed the inactive `legacy/` working-tree copy and obsolete local GCP tooling.
- Removed the legacy local port and updated workspace instructions.
- Verified that source, tests, lockfile, configuration, and built Worker behavior remained unchanged through the move.
- Preserved the previous GCP source in Git history.
- Kept the unchanged GCP deployment available as a routing-only rollback target.

**Outcome:** Cloudflare is the only active implementation in the project root. No app sync, deployment, routing change, GCP mutation, or Book write occurred during repository consolidation.

## Rollback strategy

The retained GCP deployment can receive production events again through a config-only webhook change.

- Endpoint: `https://us-central1-bkper-subledger-bot.cloudfunctions.net/prodGen2`
- Known deployed revision: `prodgen2-00020-cek`
- Matching legacy source tree: `31ffa7c77268a31f551ea5212792cc53056aa7eb`

During a rollback:

1. stop and identify the trigger;
2. restore the retained GCP endpoint in app metadata;
3. review the exact config diff and remote sync command;
4. obtain explicit approval before syncing;
5. confirm persisted routing and inspect event handling;
6. keep Cloudflare deployed for incident analysis.

The active repository no longer contains a GCP deployment project. If the retained deployment itself must be rebuilt, recover the legacy source from Git history and treat rebuilding as a separate reviewed incident action.

## Completion definition

### Application migration — complete

- Cloudflare handles production events.
- Subscribed behavior has deterministic parity coverage.
- Zero-sum and movement-direction checks pass.
- Preview, cutover, and stabilization gates passed.
- The Cloudflare app occupies the project root.
- GCP remains available for routing rollback.

### Infrastructure retirement — deferred

Deleting the retained GCP deployment, source artifacts, IAM bindings, or related infrastructure requires a future plan and explicit approval. Time elapsed alone is not a retirement criterion.

## Guidance for the next bot migration

Start from this roadmap, then simplify or expand it according to the bot being migrated.

1. **Model the domain first.** Write down its resources, movements, balance effects, relationship properties, event directions, and loop-prevention behavior.
2. **Define safety invariants.** Zero-sum integrity and data-loss prevention outrank parity and schedule.
3. **Capture the production baseline.** Record runtime, dependencies, event subscriptions, and current verification without embedding internal identifiers in the public roadmap.
4. **Split by behavior boundary.** Port ingress, shared resolution, and each resource family in separate chunks.
5. **Test before porting.** Characterize established behavior with deterministic tests and production-shaped classes.
6. **Audit dependency semantics.** Compare behavior, not only version numbers, especially around errors, nullability, authentication, retries, and API endpoints.
7. **Separate deployment from routing.** Preview first, production deployment second, routing cutover third.
8. **Use synthetic canaries.** Verify both successful movements and unresolved non-balance-affecting drafts.
9. **Keep rollback deployable.** Decommission only after enough representative evidence and a separate owner decision.
10. **Keep public evidence proportional.** Record what was proven and any limitations, but omit raw logs, resource ids, personal names, infrastructure fingerprints, and routine approval chronology.

## Optional post-migration work

### SDK modernization

Upgrading beyond `bkper-js` `2.19.0` is not a migration completion gate.

Before adopting propagated HTTP 404 errors:

- characterize every missing Account, Group, Transaction, and File lookup used as normal control flow;
- add focused tests for intentional 404 handling;
- keep authentication, permission, network, and server failures observable;
- adapt create-versus-update and fallback branches deliberately;
- validate the upgrade through preview and deterministic Book evidence as an independent behavior change.

### Boundary and response hardening

Boundary changes are also separate from migration parity. Possible future work includes validating malformed event payloads, replacing stack responses with safer errors, and defining explicit failure statuses.

Any such change must begin with tests for current behavior and prove that valid events, resource movements, balances, and the zero-sum invariant remain unaffected.
