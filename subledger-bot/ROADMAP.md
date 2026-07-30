# Subledger Bot: GCP to Cloudflare Migration Roadmap

## Status

**Chunks 1–3 complete.** The production GCP implementation remains unchanged under `legacy/`. The Cloudflare target now has its server skeleton, request-scoped context, legacy event dispatcher, and explicit business-handler stubs. Business behavior has not been ported, and no remote configuration has changed.

This is a living roadmap for moving Subledger Bot from Google Cloud Functions to the Bkper Platform on Cloudflare Workers. Work must proceed in small, independently reviewable chunks. Update this document as chunks complete, production patches arrive, or rollout evidence changes.

## Objective

Migrate the existing published `subledger-bot` app to Cloudflare without intentionally changing its business behavior.

The Cloudflare implementation will run in parallel with the current Google Cloud Function until it has passed deterministic parity checks. Production event routing will remain on GCP until a separately approved cutover. GCP will remain available as the rollback target through a stabilization period and will be decommissioned only in a final, explicitly approved step.

## Non-negotiable invariants

1. **Protect Bkper's zero-sum invariant above all else.** Every consolidated posted transaction must remain one complete movement from a mapped origin Account to a mapped destination Account for the same amount. An unresolved movement must remain a draft and must not affect balances.
2. **Migration parity first.** Do not intentionally fix, redesign, or extend legacy business behavior during the core port.
3. **Production GCP remains the moving source of truth until cutover.** Any production patch made during migration must be reviewed and translated into the Cloudflare implementation.
4. **No live Book writes during implementation tests.** Use deterministic unit tests with mocked SDK/network boundaries.
5. **No remote app or Book mutation without explicit approval.** This includes app sync/deploy/install operations and test Book setup or event generation.
6. **Separate implementation from routing.** A deployed Worker does not imply that any webhook should point to it.
7. **Keep changes small and boring.** Prefer short-lived branches and independently mergeable chunks over one long-running rewrite.

## Agreed decisions

- Use a parallel source layout:

  ```text
  subledger-bot/
  ├── ROADMAP.md
  ├── legacy/       # Current production GCP implementation
  └── new/          # Cloudflare implementation
  ```

- Relocate the current project into `legacy/` as the first isolated implementation chunk, with no logic changes.
- Build `new/` by selectively adopting the current `../bkper-app-template` conventions; do not run `bkper app init`.
- Use the template's root-plus-server workspace shape, with no client workspace.
- The new app is event-only: `/health` and `/events`; no UI, menu, public `/api/*`, OpenAPI contract, KV, secrets, or static assets.
- Preserve the existing app identity: `subledger-bot`.
- Preserve the current handler decomposition and valid-event behavior as closely as strict TypeScript allows.
- Write unit tests first and avoid live Bkper calls during implementation.
- Keep the production `webhookUrl` on GCP until final cutover.
- Do not add or sync `webhookUrlDev` until the Worker has passed parity, hardening, typecheck, tests, and build.
- Once enabled, `webhookUrlDev` will intentionally route developer-mode events for `*@bkper.com` through the preview Worker. No temporary app identity or additional routing isolation is required.
- Perform boundary/response hardening only in a separate late chunk after core parity, before preview routing.
- Include preview rollout, production cutover, rollback, stabilization, and deferred GCP decommissioning in this roadmap.

## Current production baseline

| Concern | Current state |
| --- | --- |
| App id | `subledger-bot` |
| Runtime | Google Cloud Functions Gen 2, Node.js |
| Entry point | `doPost` |
| Production webhook | `https://us-central1-bkper-subledger-bot.cloudfunctions.net/prodGen2` |
| Local GCF port | `3004` |
| HTTP stack | Express + Google Functions Framework |
| Authentication | Reads `bkper-oauth-token` and `bkper-agent-id` headers |
| SDK | `bkper-js` with request-scoped configuration |
| Tests | No existing unit test suite |
| Type safety | TypeScript with `strictNullChecks: false` and one `@ts-ignore` |
| App shape | Event-only |

### Subscribed events

- `TRANSACTION_POSTED`
- `TRANSACTION_CHECKED`
- `TRANSACTION_UPDATED`
- `TRANSACTION_DELETED`
- `TRANSACTION_RESTORED`
- `ACCOUNT_CREATED`
- `ACCOUNT_UPDATED`
- `ACCOUNT_DELETED`
- `GROUP_CREATED`
- `GROUP_UPDATED`
- `GROUP_DELETED`

### Existing domain behavior to preserve

- Child transactions consolidate into the parent Book.
- The original child transaction id is stored as a parent transaction remote id for idempotent lookup.
- `child_from` and `child_to` trace the original child Account names.
- Visible transaction, Account, and Group properties are copied; hidden properties are not.
- `parent_amount` can override the amount; `0` skips initial consolidation.
- Parent Account resolution follows the current order:
  1. `parent_account` on the child Account.
  2. `parent_account` on one of the child Account's Groups, with parent Account auto-creation when absent.
  3. Same-name parent Account when the child Group is linked through `child_book_id`.
  4. Same-name parent Account fallback.
- Parent-to-child Account and Group synchronization remains driven by `child_book_id`.
- Child Group-to-parent Account synchronization remains driven by `parent_account`.
- Exchange Bot-originated events and transactions remain skipped according to the current checks.
- Current transaction state transitions—post, check, uncheck, trash, and untrash—remain unchanged during parity work.

## Target Cloudflare shape

```text
subledger-bot/
├── AGENTS.md
├── ROADMAP.md
├── legacy/
│   └── ...current GCP project, unchanged...
└── new/
    ├── AGENTS.md
    ├── README.md
    ├── LICENSE
    ├── .gitignore
    ├── .prettierrc
    ├── bkper.yaml
    ├── bun.lock
    ├── env.d.ts
    ├── package.json
    ├── tsconfig.json
    └── server/
        ├── package.json
        ├── tsconfig.json
        ├── src/
        │   ├── index.ts
        │   ├── app-context.ts
        │   └── events/
        │       ├── routes.ts
        │       ├── types.ts
        │       └── handlers/
        └── test/
```

The exact handler filenames may follow the legacy classes. Do not use the migration as an excuse to redesign those classes into a different domain architecture.

### Runtime conventions

- Hono Worker entry point.
- Request-scoped `new Bkper()` created without token providers.
- Platform outbound authentication supplies the event user's OAuth context and app agent identity.
- Never read or forward `Authorization`, `bkper-oauth-token`, or `bkper-agent-id` in platform code.
- Strict TypeScript; no `as any`, inline dynamic imports, or global shared Bkper configuration.
- Bun package management with a committed lockfile.
- No Cloudflare bindings beyond the empty generated `Env` interface.
- Cloudflare compatibility date follows the current app template unless the platform requires a newer date.

### Local ports during parallel operation

- Keep legacy GCF port `3004` until GCP decommissioning.
- Assign Cloudflare Worker port `8790`, the next available Bkper Platform server port in the repository.
- No Vite/client port is required.
- Update the repository port documentation and forwarding script when `new/` becomes runnable.

### Initial `new/bkper.yaml` policy

The initial local file must preserve existing identity, listing metadata, event subscriptions, property schemas, and the GCP production webhook. It may add the local deployment block needed to build the Worker:

```yaml
webhookUrl: https://us-central1-bkper-subledger-bot.cloudfunctions.net/prodGen2

# Do not add webhookUrlDev until the preview-routing readiness gate.

deployment:
  server: server/src/index.ts
  secrets: []
  compatibility_date: '2026-01-28'
```

Do not add `client`, `services`, menu configuration, or a `BKPER_API_KEY` secret.

## Production patch synchronization protocol

The legacy implementation can be patched throughout the migration. Prevent drift as follows:

1. Record the current repository revision when Chunk 1 starts.
2. Treat `legacy/` as authoritative until production cutover.
3. For every subsequent patch under `legacy/`:
   - identify the changed behavior;
   - add or update the corresponding parity test under `new/server/test/`;
   - translate the behavior into `new/` when that area has already been ported;
   - record the translation status below.
4. Before preview routing, review all legacy changes since the baseline.
5. Immediately before production cutover, repeat the review from the latest audited revision.
6. If production was deployed from uncommitted or otherwise unavailable source, stop and obtain that exact source before proceeding.

### Patch ledger

| Legacy change | Production status | Cloudflare test | Cloudflare port | Notes |
| --- | --- | --- | --- | --- |
| _Populate during migration_ |  |  |  |  |

### Audit checkpoints

| Checkpoint | Legacy revision reviewed | Reviewer | Result |
| --- | --- | --- | --- |
| Migration baseline | `d1a1bbd8f00281be619cda9d67b4b1d5c13cabc4` | — | Legacy relocation complete; build verified before and after the move |
| Before preview routing | TBD | TBD | TBD |
| Before production cutover | TBD | TBD | TBD |

## Verification strategy

### Unit-test boundary

Use deterministic unit tests and typed fakes or controlled HTTP interception around `bkper-js`. Tests must not require credentials, network access, a Cloudflare deployment, or a live Book.

Every implementation chunk follows TDD:

1. Add the smallest failing test that describes existing production behavior.
2. Add any required production method stub with the intended typed signature.
3. Implement only enough behavior to pass.
4. Run the focused tests.
5. Run the full `new/` check before completing the chunk.

### Parity behavior matrix

The suite must collectively protect the subscribed production behaviors without redundant tests.

#### Event ingress and routing

- Every subscribed event routes to the corresponding handler.
- Unknown events return the legacy no-op response.
- Parent and child Books are distinguished by `parent_book_id`, including the legacy `parent_book` fallback.
- Parent-side transaction events remain no-ops.
- Exchange Bot skip behavior remains unchanged.
- Handler return values preserve the legacy response envelope during the parity phase.

#### Transaction movements and state

- A new parent transaction preserves date, amount, description, visible properties, remote id, `child_from`, and `child_to`.
- The parent movement direction matches the child movement after Account mapping: child origin maps to parent origin, and child destination maps to parent destination.
- Both sides receive the same amount; no handler creates a one-sided posted movement.
- Complete parent transactions post; unresolved transactions remain drafts and do not affect balances.
- Direct Account `parent_account`, Group `parent_account`, linked-Group same-name, and final same-name fallback behavior remain ordered as today.
- Group-based parent Account auto-creation remains unchanged.
- `parent_amount` override and zero behavior remain unchanged for each applicable event path.
- Existing remote-id matches prevent duplicate creation and drive the same post/check/update/delete/restore behavior as legacy.
- Update behavior preserves current property, URL, and file-URL handling.
- Checked parent transactions are unchecked before the same legacy mutations.
- Delete unchecks when required and trashes the parent transaction.
- Restore finds trashed remote-id matches and untrashes them.

#### Account synchronization

- Parent Account create/update syncs to the child Book selected by the current `child_book_id` lookup behavior.
- Name, type, visible properties, archived state, and eligible Group membership remain unchanged.
- Rename lookup through `previousAttributes.name` remains unchanged.
- Parent Account deletion preserves the current delete/archive branch behavior exactly.
- Child-side Account events remain no-ops.

#### Group synchronization

- Parent Group create/update/delete behavior remains unchanged for `child_book_id` Groups.
- `child_book_id` is not copied into the child Group.
- Rename lookup through previous attributes remains unchanged.
- Child Group create/update/delete manages the parent Account only when `parent_account` is present, following current lookup and type behavior.
- Existing no-op branches remain no-ops.

### Required local gates

The final script names may follow the template, but `new/` must provide one deterministic root check covering:

```bash
bun test
bun run typecheck
bun run build
prettier --check .
```

The build may generate local artifacts such as `env.d.ts` and `dist/`; it must not sync or deploy the app.

No visual verification is required because the migrated app has no user interface.

## Known legacy edge cases: do not silently fix during parity

The following deserve explicit tests or documentation because strict TypeScript or template patterns may tempt cleanup. Preserve valid production behavior first and handle defects only in separately approved work.

- Duplicate/unreachable `GROUP_DELETED` switch case in the legacy entry point.
- Direct access to optional event fields and legacy stack-array error responses.
- Draft-description construction when a mapped parent Account is missing.
- Existing `parent_amount: 0` behavior when updating an already connected transaction.
- Existing Account/parent-Account delete-versus-archive branch behavior.
- Checked-event responses when the connected parent draft is not ready to post.
- File attachments represented as URLs during parent transaction updates.
- Selection of only the first applicable `child_book_id` relationship in current Account synchronization.
- Lack of a generic self-agent guard; current loop avoidance relies on event direction, no-op branches, remote ids, and Exchange Bot checks.

If an observed legacy behavior could violate zero-sum integrity or cause data loss, stop the migration chunk and escalate it. Do not choose parity over the invariant.

## Implementation chunks

### Chunk 1 — Establish baseline and split `legacy/` from `new/`

**Scope**

- Record the migration baseline revision and clean working-tree state.
- Capture the current legacy build/test outcome before moving files.
- Move the current GCP project into `subledger-bot/legacy/` using rename-only changes.
- Add root migration instructions describing `legacy/` as production-authoritative and `new/` as the migration target.
- Update repository navigation only as required by the move.

**Do not**

- Change legacy source, dependencies, configuration, README behavior, or deployment scripts.
- Repair unrelated pre-existing build failures in the same chunk.

**Verification**

- Compare the pre-move and post-move file contents.
- Run the same legacy verification command from its new path.
- If the baseline was already failing, document the identical failure rather than claiming success.

**Completion criteria**

- Production code is byte-for-byte equivalent apart from path-dependent metadata that must change.
- Team members have an explicit path for future GCP patches.

### Chunk 2 — Create the minimal server-only Cloudflare skeleton

**Scope**

- Selectively copy current template tooling and instructions into `new/`.
- Add root and server package manifests, strict TypeScript configuration, formatting, generated empty `Env`, and Bun lockfile.
- Add `new/bkper.yaml` with current app metadata, GCP production webhook, and server-only deployment configuration.
- Preserve the end-user README and license in the deployable new project.
- Add `/health` and a typed `/events` production stub.
- Assign Worker port `8790` and update repository port documentation/forwarding.

**Tests first**

- `/health` returns `{ "status": "ok" }`.
- `/events` stub returns the current no-op response without reading legacy auth headers.
- Unknown routes do not require static assets.

**Completion criteria**

- Tests, strict typecheck, formatting, and Worker build pass.
- No `webhookUrlDev` exists.
- No app sync, deploy, installation, or Book write has occurred.

### Chunk 3 — Add the parity harness and legacy event dispatcher

**Scope**

- Add typed event-result definitions and request-scoped app context.
- Reproduce the legacy event switch and response envelope.
- Introduce handler stubs with production signatures before implementations.
- Preserve legacy response behavior during this phase; do not apply boundary hardening yet.

**Tests first**

- Routing for all subscribed event types.
- Unknown-event no-op.
- Existing response envelope and error shape.
- Proof that platform code does not consume legacy auth headers.

**Completion criteria**

- Dispatcher behavior is characterized and all business handlers are still explicit stubs.

### Chunk 4 — Port shared Book-direction and Account-mapping behavior

**Scope**

- Port base parent/child Book resolution.
- Port Book anchors and response formatting required by handlers.
- Port Exchange Bot event skip behavior.
- Port linked Group and parent Account resolution in current priority order.
- Preserve current auto-creation and fallback semantics.

**Tests first**

- Parent versus child dispatch, including `parent_book` fallback.
- Every Account-mapping strategy and priority.
- Missing mapping behavior.
- Group-based parent Account auto-creation.

**Zero-sum gate**

- Mapping utilities may select Accounts but must never independently create a transaction side or amount.

### Chunk 5 — Port transaction creation: posted and checked

**Scope**

- Port `TRANSACTION_POSTED` and `TRANSACTION_CHECKED` behavior.
- Preserve remote-id lookup, visible properties, trace properties, amount override, drafts, posting, and checking.
- Preserve current human-readable result strings.

**Tests first**

- Complete movement creation and direction.
- Unresolved mapping produces a draft, not a posted partial movement.
- Same amount is applied to both sides through one `Transaction` object.
- Existing remote-id match behavior.
- `parent_amount` override and zero behavior.
- Exchange Bot transaction-agent skip.

### Chunk 6 — Port transaction update, delete, and restore

**Scope**

- Port `TRANSACTION_UPDATED`, `TRANSACTION_DELETED`, and `TRANSACTION_RESTORED` behavior.
- Preserve checked-state handling, URL/file URL behavior, trashed queries, and result strings.

**Tests first**

- Update only when a connected transaction exists.
- Current behavior when either mapped parent Account is unresolved.
- Current `parent_amount` update behavior.
- Uncheck-before-update/delete behavior.
- Trash and untrash state transitions.
- No direction or amount inversion during update.

### Chunk 7 — Port Account synchronization

**Scope**

- Port `ACCOUNT_CREATED`, `ACCOUNT_UPDATED`, and `ACCOUNT_DELETED`.
- Preserve parent-to-child-only behavior and current child Book selection.
- Preserve rename, visible properties, archived state, and linked Group membership.

**Tests first**

- Create, update, rename, and not-found behavior.
- Exact current delete/archive branches.
- Child-side Account no-op.
- No transaction or balance mutation from Account handlers.

### Chunk 8 — Port Group synchronization

**Scope**

- Port `GROUP_CREATED`, `GROUP_UPDATED`, and `GROUP_DELETED` in both current directions.
- Preserve `child_book_id` removal from copied child Groups.
- Preserve child Group `parent_account` behavior for managing parent Accounts.

**Tests first**

- Parent-to-child create/update/delete and rename lookup.
- Child-to-parent Account create/update/delete/archive.
- Current no-op paths when relationship properties are absent.
- Exchange Bot skip behavior.

### Chunk 9 — Full parity and legacy-drift audit

**Scope**

- Run the complete behavior matrix.
- Compare `new/` against every legacy production change since the migration baseline.
- Translate missing patches through tests first.
- Review generated artifacts, dependency versions, bundle contents, and configuration.
- Update the patch ledger and pre-preview audit checkpoint.

**Completion criteria**

- Full deterministic check passes.
- No known production patch is missing.
- Valid-event response strings and state transitions match legacy.
- No Cloudflare preview routing has been enabled.

### Chunk 10 — Boundary and response hardening

This is intentionally separate from core migration parity.

**Scope**

- Validate missing Book and structurally invalid event payloads at ingress.
- Return template-style no-op, client-error, and handler-error responses as previously agreed.
- Ensure unexpected errors are represented safely without exposing unnecessary stacks.
- Confirm valid subscribed events are unaffected.

**Tests first**

- Unsupported/irrelevant event: `200 { "result": false }`.
- Missing or invalid Book/event payload: clear `400` error.
- Handler/API failure: `200 { "error": "..." }` for Bkper activity visibility without infrastructure retry behavior.
- All valid-event parity tests remain unchanged and pass.

**Out of scope**

- Fixing the known business-logic edge cases listed above.
- Adding new loop guards or changing event semantics without a separate decision.

### Chunk 11 — Preview deployment readiness and developer-domain canary

**Readiness gate before changing `webhookUrlDev`**

- Full check passes from a clean install.
- Boundary hardening is complete.
- Pre-preview legacy drift audit is signed off.
- Preview bundle is built and reviewed.
- Rollback endpoint is recorded.
- Team understands that `*@bkper.com` developer events may route to preview.

**Operational sequence**

1. Show the exact preview deployment command and obtain explicit approval.
2. Deploy the preview Worker while production `webhookUrl` remains on GCP.
3. Verify preview `/health` and inspect preview logs.
4. Add locally:

   ```yaml
   webhookUrlDev: https://subledger-bot-preview.bkper.app/events
   ```

5. Show the exact `bkper app sync` command and obtain explicit approval before changing remote app metadata.
6. Validate with dedicated synthetic-data parent/child Books on the live Bkper platform.
7. Accept and monitor the intentionally broad `*@bkper.com` developer-mode canary.

**Important operational note**

Running `bkper app dev` can replace `webhookUrlDev` with a tunnel URL. Do not run it before readiness, and restore/sync the preview URL before further preview validation if it is run later.

**Book-write policy**

Creating test Books, Accounts, Groups, Transactions, Collections, installing the app, or replaying events are writes. Before any such action, show exact commands or UI actions and obtain explicit confirmation.

### Chunk 12 — Deterministic preview validation

Do not use LLM judgment as the final accounting check. Collect reproducible evidence.

For each representative event path:

1. Record the source event id and resource id.
2. Read the child resource and resulting parent/child counterpart through the Bkper UI, SDK-backed test tooling, or read-only CLI commands.
3. For transaction consolidation, query the parent by `remoteId:<childTransactionId>`.
4. Assert deterministically:
   - exactly one connected parent transaction exists;
   - origin and destination match the configured mapping;
   - the amount matches current `parent_amount` rules;
   - posted/checked/trashed state matches the event;
   - visible and trace properties match expectations;
   - unresolved transactions remain drafts;
   - no one-sided posted movement exists.
5. Inspect Bkper event responses and preview Worker logs for errors.
6. Retain the evidence and human-review links in the rollout record.

The canary must cover transaction, Account, and Group paths, including at least one many-to-one permanent Account mapping and one same-name non-permanent Account mapping.

**Completion criteria**

- Deterministic assertions pass.
- No unexplained duplicate, missing, reversed, or imbalanced movement exists.
- No unresolved authentication or event-routing errors remain.
- Preview evidence is reviewed by a human owner.

### Chunk 13 — Final drift audit and production Worker deployment

**Scope**

- Repeat the legacy patch audit against the latest production source.
- Port and test any remaining changes.
- Build the exact production artifact from a clean install.
- Show the exact production deployment command and obtain explicit approval.
- Deploy and health-check the production Worker while `webhookUrl` still points to GCP.

**Completion criteria**

- Production Cloudflare `/health` succeeds.
- Production Worker logs are available.
- GCP still receives production events.
- Rollback remains unchanged and immediately available.

### Chunk 14 — Production webhook cutover

**Preconditions**

- Preview canary accepted.
- Production Worker health-check accepted.
- Final drift audit signed off.
- Cutover owner and rollback owner identified.
- Monitoring window agreed.

**Config-only change**

```yaml
webhookUrl: https://subledger-bot.bkper.app/events
```

Before running `bkper app sync`, show the exact command and obtain explicit approval.

**Immediate monitoring**

- Cloudflare production event logs.
- Bkper event responses and `error:true`/error-event inspection.
- Authentication failures.
- Missing or duplicate remote-id-linked transactions.
- Incorrect movement direction or amount.
- Unexpected draft, checked, or trashed states.
- Account/Group synchronization errors.

**Rollback trigger examples**

- Any suspected zero-sum or data-loss issue.
- Reversed or mismatched parent movements.
- Duplicate consolidation.
- Sustained authentication or platform failures.
- Material increase in bot error responses.
- Missing production patches discovered after cutover.

**Rollback action**

Restore the known GCP URL in `webhookUrl`, review the exact diff, show the exact sync command, obtain explicit approval, and sync. Do not undeploy Cloudflare during incident analysis.

### Chunk 15 — Stabilization

- Keep GCP deployable and untouched as the rollback target.
- Continue read-only log and Bkper event monitoring.
- Complete deterministic spot checks across all event families.
- Reconcile any events around the cutover boundary by event/resource id and remote id.
- Record incidents, replays, manual interventions, and their approvals.
- Decide the stabilization duration based on observed event volume and evidence; do not decommission merely because a fixed number of days passed.

**Exit criteria**

- No unresolved migration-related errors.
- Representative production volume has exercised all meaningful event families.
- Deterministic checks show no duplicate, missing, reversed, or imbalanced movements.
- No rollback has been required for the agreed observation window.
- Human owner explicitly approves GCP retirement.

### Chunk 16 — Deferred GCP decommissioning

This chunk requires separate planning and explicit approval.

- Capture final GCP deployment configuration and rollback documentation.
- Confirm Cloudflare is the registered production webhook.
- Confirm no scripts, IAM bindings, monitoring, or team workflows still depend on the GCF.
- Remove obsolete GCF/ngrok/Functions Framework deployment tooling from `legacy/` only after archival requirements are agreed.
- Decommission the Google Cloud Function and related infrastructure through the approved infrastructure process.
- Remove legacy port `3004` and obsolete repository instructions.
- Decide whether to retain `legacy/` as an archive or remove it in a separate reviewed change.
- Update this roadmap and app documentation to record completion.

## Remote command control

The following are examples only and must not be executed merely because they appear in this roadmap:

```bash
cd subledger-bot/new

# Local verification; no remote app or Book write
bun run check

# Remote app writes; require explicit approval immediately before execution
bkper app deploy --preview
bkper app sync
bkper app deploy
```

Any Book installation or test-data command also requires the exact command and explicit confirmation immediately before execution.

Read-only commands such as app status/log inspection and Book/event/transaction queries may be used without Book-write approval after loading the relevant Bkper CLI documentation.

## Migration completion definition

The migration is complete only when:

- Cloudflare handles the published app's production events.
- All subscribed event families have deterministic parity evidence.
- The latest legacy production patches are included.
- Zero-sum and movement-direction checks pass.
- Rollback and stabilization criteria have been satisfied.
- GCP has been decommissioned through an explicitly approved final chunk.
- Repository instructions and ports reflect the final Cloudflare-only state.

Until all criteria are met, this remains an active migration rather than a completed platform replacement.
