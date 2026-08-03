# Subledger Bot: GCP to Cloudflare Migration Roadmap

## Status

**Chunks 1–11 complete; Chunk 12 pre-deployment gates passed and production Worker deployment is pending.** The final drift audit found no legacy or deployed-GCP change, and the clean release gate reproduced the exact preview-canary artifact. The Cloudflare target pins `bkper-js` `2.19.0`, retaining deployed GCP's nullable-404 behavior while using the platform-authenticated API endpoint. Developer-mode events route to preview through `webhookUrlDev`; production events remain on GCP. The exact release revision must be committed and pushed before a separately approved production Worker deployment.

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

## Mechanical parity port rules

These rules apply to every core migration chunk and are completion gates, not preferences.

- Preserve legacy source class, method, and parameter names; class decomposition; branch and lookup order; constructor timing; instance lifetime; return normalization; logging; API-call order; and side effects.
- Do not rename, clean up, optimize, refactor, modernize, or otherwise improve legacy code during the port.
- Do not add factories, registries, handler maps, dependency injection, services, utilities, adapters, shared instances, or other production abstractions unless they already exist in legacy or receive explicit approval before implementation.
- Testability does not justify changing production architecture. Use deterministic fakes or controlled SDK/network interception around the production shape.
- Mechanical changes allowed without a separate decision are limited to import paths/module syntax, strict TypeScript annotations and nullability, the Express-to-Hono request boundary, request-scoped platform authentication, and packaging/build configuration already specified here. They must not alter control flow or behavior.
- Before any other deviation, present the exact legacy code, proposed target code, and why the deviation is unavoidable, then wait for explicit approval.
- Name class-specific tests after their corresponding legacy classes to keep source-to-target traceability explicit.
- Before completing a chunk, compare legacy and new implementations side by side and record every deviation. Unexplained or unapproved deviations block completion.

## Chunks 1–4 corrective parity audit

The corrective pass after Chunk 4 removed production structure that existed only to support test injection or generic architecture:

- Removed the app, context, dependency, and handler-map factories.
- Removed the handler registry, production handler contracts, eager construction of every handler, and shared Account/Group handler instances.
- Restored direct construction of only the selected handler inside the event switch.
- Restored the legacy `AppContext`, base-handler constructor shape, and currently ported method and parameter names. Scheduled concrete handlers remain empty stubs until their behavior is ported.
- Moved dispatcher tests to test-only prototype interception and restored class-specific test filenames.

The remaining differences from legacy in the completed scope are required or already approved for the target runtime:

| Area | Retained difference | Reason |
| --- | --- | --- |
| HTTP boundary | Hono Worker with `/health` and `/events` instead of Express/Functions Framework | Cloudflare runtime requirement and approved server-only skeleton |
| Authentication | Request-scoped `new Bkper()` without header token, API-key, or agent providers | Platform outbound authentication requirement |
| Request context | `AppContext` carries only `Bkper`; unused `express-http-context` accessors are absent | Express-specific state is neither used by legacy handlers nor available in the Worker |
| TypeScript | Explicit nullable returns, optional SDK results, non-null event assertions, and `unknown` error narrowing | Strict TypeScript requirement |
| Source layout | Worker entry point and event modules wrap the preserved handler-class decomposition | Approved Cloudflare workspace and Hono route layout |
| Unreachable switch branch | The second legacy `GROUP_DELETED` case is omitted; the first case always handles that value | Avoid a Worker build warning without changing valid-event routing |
| Syntax | Formatting, immutable locals, and strict equality remain where they do not change the value domain or behavior | Avoid cosmetic churn unrelated to migration risk |

Within the behavior ported through Chunk 4, the corrective comparison found no remaining handler factory, registry, shared-instance, constructor-timing, lookup-order, API-call-order, or return-normalization deviation. Future transaction and synchronization behavior remains deferred to its scheduled chunks.

## Chunk 5 parity audit

The posted and checked transaction handlers now preserve the legacy shared transaction flow, remote-id lookup, Exchange Bot transaction-agent skip, movement construction, visible and trace properties, `parent_amount` behavior, draft/post/check transitions, API-call order, and result strings.

- Complete mapped transactions are built as one `Transaction` carrying one amount and both mapped Accounts before posting.
- Unresolved mappings create drafts and do not affect balances.
- The legacy draft-description expression, including its non-awaited Account getter comparisons, remains unchanged in runtime behavior. This known defect was explicitly left unfixed for migration parity.
- At Chunk 5 completion, transaction update/delete/restore classes contained only the legacy-shaped query/found/not-found method stubs required by the ported abstract transaction base contract; their business behavior was subsequently ported in Chunk 6.
- Tests use only test-side SDK/network interception; no production factory, dependency injection, registry, or testing hook was introduced.

The remaining source differences in Chunk 5 are strict TypeScript annotations and non-null assertions, module paths, formatting, immutable locals, `Promise.resolve(null)` for strict Promise-returning no-op methods, and the already-approved Cloudflare runtime differences. The side-by-side comparison found no unexplained movement-direction, amount, property, remote-id, state-transition, lookup-order, API-call-order, or response deviation.

## Chunk 6 parity audit

The transaction update, delete, and restore handlers now preserve the legacy remote-id queries, checked-state handling, movement updates, URL/file-URL behavior, trash/untrash transitions, API-call order, and result strings.

- Updates occur only when a connected parent transaction and both mapped parent Accounts resolve.
- Checked parent transactions are unchecked before update or deletion.
- Update preserves movement direction, applies one amount to the existing complete `Transaction`, copies visible and trace properties, and appends child file URLs to the current child URL array before setting parent URLs.
- The current `parent_amount: 0` update behavior remains unchanged: a checked connected transaction is unchecked, no update call occurs, and the legacy `EDITED` response describes the existing transaction.
- Delete unchecks when required before trashing; restore queries `remoteId:<id> is:trashed` before untrashing.
- Tests use only test-side SDK/network interception; no production factory, dependency injection, registry, or testing hook was introduced.

The remaining source differences in Chunk 6 are strict TypeScript annotations and non-null assertions, module paths, formatting, immutable locals, and `Promise.resolve(null)` for strict Promise-returning no-op methods. The side-by-side comparison found no unexplained movement-direction, amount, property, URL, state-transition, query, API-call-order, or response deviation.

## Chunk 7 parity audit

The Account handlers now preserve the legacy parent-to-child Book selection, Account lookup, create/update/delete/archive behavior, Group membership synchronization, API-call order, error shape, and result strings.

- Parent Account events select the first Account Group carrying `child_book_id` and load that child Book.
- Child Account lookup uses the current parent Account name first, then `previousAttributes.name` for rename events.
- Create and update preserve name, type, visible properties, archived state, and only Group memberships linked to the selected child Book.
- Delete preserves the current legacy branch exactly: `hasTransactionPosted()` removes the child Account; otherwise the child Account is archived and updated.
- Parent Accounts with no linked child Book and child-side Account events remain no-ops.
- Tests execute the production handlers and real SDK models while intercepting only SDK/network boundaries; no production testing hook or abstraction was introduced, and no transaction endpoint is called.

The remaining source differences in Chunk 7 are strict TypeScript annotations and non-null assertions, module paths, formatting, immutable locals, and `Promise.resolve(null)` where strict Promise return types require it. The side-by-side comparison found no unexplained Book-selection, lookup-order, property, archived-state, Group-membership, API-call-order, or response deviation.

## Chunk 8 parity audit

The Group handlers now preserve the legacy parent-to-child Group synchronization and child-to-parent Account synchronization, including relationship lookup order, resource mutations, API-call order, and result strings.

- Parent Group events load the child Book only from `child_book_id`, look up the current Group name first, and then use `previousAttributes.name` for rename events.
- Child Group create and update preserve the parent Group name and visible properties while clearing `child_book_id` through the legacy SDK `deleteProperty` behavior.
- Child Group events manage a parent Account only when `parent_account` is present, look up its current value before `previousAttributes.parent_account`, and derive the Account type by loading the child Group by id.
- Parent-to-child Group deletion and child-to-parent Account create/update/delete/archive behavior preserve the current legacy branches exactly, including the existing `hasTransactionPosted()` delete-versus-archive branch.
- Events without the applicable relationship property remain no-ops, and the shared Exchange Bot event skip remains unchanged.
- Tests execute the production handlers and real SDK models while intercepting only SDK/network boundaries; no production testing hook or abstraction was introduced, and no transaction endpoint is called.

The remaining source differences in Chunk 8 are strict TypeScript annotations and non-null assertions, type-only imports and module paths, explicit nullable returns, formatting, immutable locals, and explicit `public` modifiers where legacy TypeScript used the equivalent default visibility. The side-by-side comparison found no unexplained Book-selection, lookup-order, Account-type, property, resource-mutation, API-call-order, no-op, error, or response deviation.

## Chunk 9 full parity and legacy-drift audit

The complete behavior matrix and every legacy/Cloudflare handler pair were reviewed against legacy revision `d0cdf996348150158c8d0e59f32e9c47a2c44555`.

- Git history and byte comparison found no production change under `legacy/` since the migration baseline. All 23 baseline production files match their relocated copies exactly, so there is no missing patch to translate.
- The side-by-side source audit restored the legacy public visibility of the transaction Book-direction methods, the protected visibility of the Group child-to-parent method, and the direct Promise return in Group child-Book loading. Group tests now expose the protected method only through test-side subclasses; no production testability hook remains.
- Deterministic coverage now explicitly protects the no-op for an already-posted remote-id match and the current response/no-write behavior for a connected checked-event draft that is not ready to post.
- `new/bkper.yaml` metadata matches the production file exactly apart from the approved `deployment` block. It still has the GCP `webhookUrl`, no `webhookUrlDev`, no client/services, and no secrets.
- Runtime and tooling dependencies are exactly pinned in `bun.lock` and were current at the audit. The generated `env.d.ts` remains empty, and the reviewed Worker artifact contains the expected Hono and `bkper-js` dependency trees plus authored server sources. Auth-header support present inside the bundled SDK remains dormant because authored code configures no token, API-key, or agent provider.
- The full local check passes with 74 deterministic tests, strict production and test typechecks, a 582,841-byte Worker bundle, and clean formatting. The legacy build also passes. No credentials, network-backed Book access, live Book writes, deployment, app sync, or routing mutation occurred.

The remaining differences from legacy are the approved Cloudflare/Hono boundary, request-scoped platform authentication, reduced `AppContext`, strict TypeScript annotations and nullability, module paths and type-only imports, immutable locals and formatting, `Promise.resolve(null)` where strict Promise signatures require it, and omission of comments and the unreachable duplicate `GROUP_DELETED` branch. The audit found no unexplained class decomposition, method/parameter name, visibility, constructor timing, instance lifetime, branch/lookup order, API-call order, resource mutation, movement direction, amount, state transition, logging, side-effect, return normalization, or valid-event response deviation.

## Chunk 10 preview canary evidence and resolution

The first live canary ran on 2026-08-03 after a clean 74-test check, preview deployment, and temporary developer routing to `https://subledger-bot-preview.bkper.app/events`.

- Canary Collection: `4edac894-5d06-49b2-9039-36ea0c687f58` (`Subledger Bot Preview Canary`).
- Parent Book: `agtzfmJrcGVyLWhyZHITCxIGTGVkZ2VyGICA4JLp4aIJDA` (`Subledger Preview Parent`).
- Child Book: `agtzfmJrcGVyLWhyZHITCxIGTGVkZ2VyGICA4PLeragJDA` (`Subledger Preview Child`), configured with the parent Book id.
- Baseline mapping: child `Customer A` and `Customer B` Accounts in `Customers`, whose `parent_account` is the parent `Accounts Receivable` Account. Both Books had zero transactions before the canary, and the app was installed on both.
- Canary action: create parent Group `Revenue` (`2990047024`) with `child_book_id` set to the child Book.
- Source event: `GROUP_CREATED` event `3f3a12fd-ea03-4ce6-8736-1b82cda89cc5`.
- Preview evidence: Cloudflare preview logs recorded the matching `/events` request and `Failed to handle group [Revenue] event: BkperError: Group NOT found! ID: Revenue`; the same error appears in the event's `subledger-bot` response.
- Expected behavior: a missing child Group returns no match and `childGroupNotFound()` creates it without copying `child_book_id`.
- Actual behavior: `childBook.getGroup('Revenue')` threw on HTTP 404, so the creation branch never ran. No child Group, transaction, or balance was created or changed.

The root cause is dependency semantics rather than the Cloudflare runtime. Direct inspection of GCP revision `prodgen2-00020-cek` and container digest `sha256:1b199f5229bdd716037ecf48cac87a10fd45ef7212405472db5f2f76545fcd64` found installed `bkper-js` `2.18.0`. Versions through `2.25.0` converted HTTP 404 to `null`; commit `fe2e4a3` intentionally changed 404 handling to throw `BkperError` in `2.26.0`. The initial Cloudflare preview pinned `2.42.0`, so its missing child-Group lookup threw before the preserved creation branch could run.

Pinning the target directly to `2.18.0` restored nullable 404 behavior but also restored the legacy direct API URL, causing 24 deterministic URL assertions to fail. `2.19.0` is the minimal migration-compatible version: it preserves nullable 404 behavior while defaulting request-scoped, provider-free SDK calls to `https://api.bkper.app`, the endpoint used by platform outbound authentication. No handler or authentication code changed. With `2.19.0` pinned exactly, all 74 tests, strict typechecks, build, and formatting pass; the reviewed 535,145-byte bundle contains both the modern proxy endpoint selection and nullable 404 handling.

The migration-compatible bundle was deployed to preview from source revision `96378e0`; its SHA-256 was `c07306ee1e5b3caf5d0c21ac031e22d99a58b34d951cc43a3d9e65dd4e7ed9fa`. After a separate committed configuration sync, remote routing preserved the GCP production webhook and set `webhookUrlDev` to `https://subledger-bot-preview.bkper.app/events`.

The isolated replay canary then passed:

- Replaying event `3f3a12fd-ea03-4ce6-8736-1b82cda89cc5` only for agent `subledger-bot` returned an `INFO` response ending in `CHILD GROUP Revenue CREATED`.
- Preview logs recorded the matching authenticated `GROUP_CREATED` request, HTTP 200, `CREATE: Revenue`, and the expected result without an error. The `Token provider NOT configured!` warnings are expected from `bkper-js` `2.19.0`; platform outbound authentication supplied the actual API authorization.
- Child Group `Revenue` was created exactly once as id `3030867030`, with no properties and therefore no copied `child_book_id`.
- Read-only transaction queries returned empty arrays for both Books. Balance reports contained only Account headings with no value rows, matching the zero-transaction baseline; no movement or balance changed.
- A human owner opened `https://subledger-bot-preview.bkper.app/health` through the platform-authenticated browser boundary and confirmed `{"status":"ok"}`. Unauthenticated and CLI bearer-token requests correctly stopped at the platform login redirect rather than reaching the Worker.

Chunk 10 is complete. Developer preview routing remains active for the approved `*@bkper.com` domain canary while Chunk 11 exercises the broader deterministic Account, Group, and transaction matrix. Production routing remains on GCP.

Operational security follow-up: the read-only GCP function description surfaced the configured API-key environment value in command output. Do not copy it into migration records; rotate it through the approved GCP process.

## Chunk 11 deterministic preview validation evidence

The representative Account and transaction canaries ran on 2026-08-03 in the dedicated Chunk 10 Collection and Books. All writes were individually approved, and final assertions used read-only CLI queries, event records, and preview Worker logs.

### Account synchronization and mapping setup

- Creating parent `INCOMING` Account `Consulting Revenue` (`3016987020`) in parent Group `Revenue` produced `ACCOUNT_CREATED` event `1783edfc-a97d-4d64-910d-d274c90943be`.
- Preview returned HTTP 200 with `CHILD ACCOUNT Consulting Revenue CREATED` and created child Account `3036357026` with the same name, type, archived state, and membership in child Group `Revenue`.
- This established the required same-name non-permanent mapping through the linked parent/child `Revenue` Groups.
- Child-only `ASSET` Account `Unmapped Canary Asset` (`3015217024`) had no Group or mapping. Its `ACCOUNT_CREATED` event `1a1456ef-cd57-485b-9e2e-5a6e82065b75` returned the expected child-side no-op, and no parent counterpart appeared.

### Fully mapped consolidation

- Child transaction `48e3a0b5-a027-42a7-bfe9-b5f7cf3dd0fb` moved `100.00` from `Consulting Revenue` to `Customer A`, was posted, and carried visible property `canary=chunk11`.
- `TRANSACTION_POSTED` event `e89bb26c-404e-417f-90f1-bddad7ea1afa` reached preview with HTTP 200 and no error.
- The parent query `remoteId:48e3a0b5-a027-42a7-bfe9-b5f7cf3dd0fb` returned exactly one transaction, `c7517a63-1d2b-44b7-8954-8dff0da67e3a`.
- The parent transaction is a complete posted movement of `100.00` from same-name non-permanent Account `Consulting Revenue` to permanent Account `Accounts Receivable`, which resolves the child `Customer A` through Group property `parent_account=Accounts Receivable`.
- The parent preserved `canary=chunk11` and added `child_from=Consulting Revenue` and `child_to=Customer A`; it remained unchecked and not trashed.

### Unresolved mapping protection

- Both canary Books have `autoPost: true`. Ordinary complete CLI creation therefore posted the fully mapped transaction immediately.
- Creating the unresolved canary through the stdin transaction payload with explicit `draft: true` persisted child transaction `f7f073fe-2ac9-4fae-8147-fedda360f241` as a draft despite auto-post. The immediate batch response incorrectly reported it as posted, but the authoritative transaction query, `TRANSACTION_CREATED` event `0ec24278-a481-4a67-93bb-f55543bcc333`, zero balance effect, absence of a posted event, and absence of a parent remote-id match all confirmed the persisted draft state.
- After separately approved posting, event `2f42092c-6974-43ff-a8cb-eba3f20aef8e` reached preview with HTTP 200. The complete child movement of `7.00` ran from `Consulting Revenue` to `Unmapped Canary Asset`.
- The parent remote-id query returned exactly one transaction, `103ff8ad-ca8e-4209-9e2d-1ea49cc74834`: amount `7`, mapped source `Consulting Revenue`, no destination Account, `draft: true`, `posted: false`, unchecked, not trashed, and carrying `canary=chunk11-unresolved`, `child_from=Consulting Revenue`, and `child_to=Unmapped Canary Asset`.
- Post-event parent balances remained `100.00` for both `Consulting Revenue` and `Accounts Receivable`; the incomplete parent draft had no balance effect. The only posted parent transaction remained the complete `100.00` movement. No one-sided posted movement exists.
- Child balances deterministically reflected its two complete movements: `Consulting Revenue` `107.00`, `Customer A` `100.00`, and `Unmapped Canary Asset` `7.00`.

Preview logs showed the expected `Token provider NOT configured!` warnings from `bkper-js` `2.19.0`, successful HTTP 200 event requests, expected result messages, and no errors. A human owner reviewed and accepted the evidence. Chunk 11 is complete; production routing remains on GCP and developer preview routing remains active.

## Chunk 12 final drift audit and release gate evidence

The final pre-production audit and clean release gate ran on 2026-08-03 without any remote mutation.

### Production-source and rollback audit

- Baseline and HEAD resolve `subledger-bot/legacy` to the same Git tree, `31ffa7c77268a31f551ea5212792cc53056aa7eb`: 23 tracked files and zero differences since baseline `d0cdf996348150158c8d0e59f32e9c47a2c44555`.
- GCP function `prodGen2` remains active on Node.js 22 with entry point `doPost`, 256 MiB memory, 360-second timeout, and five maximum instances. Its update time remains `2026-01-14T14:49:59.333066641Z`.
- The active Cloud Run revision remains `prodgen2-00020-cek`, using immutable image digest `sha256:1b199f5229bdd716037ecf48cac87a10fd45ef7212405472db5f2f76545fcd64`. Because the artifact is unchanged, the previously inspected installed `bkper-js` version remains `2.18.0`.
- Field-limited GCP commands omitted environment variables and did not expose the configured API key again.
- Every legacy/Worker handler pair, shared context, constants, and dispatcher boundary was compared again. No unexplained class, branch, lookup, movement, amount, mutation, API-call-order, state-transition, logging, response, or zero-sum difference was found.
- The only Worker production-source changes since the prior audit are the already-reviewed method-visibility corrections and direct Promise return in Group child-Book loading.

### Clean release gate

- From a removed `node_modules` and `dist`, `bun install --frozen-lockfile` succeeded.
- All 74 deterministic tests passed with 271 assertions, followed by strict production and test typechecks, Worker build, and formatting.
- The legacy GCP build also passed after its existing install/build sequence.
- The installed target dependency is exactly `bkper-js` `2.19.0`.
- The 535,145-byte Worker artifact has SHA-256 `c07306ee1e5b3caf5d0c21ac031e22d99a58b34d951cc43a3d9e65dd4e7ed9fa`, exactly matching the bundle that passed the preview canaries.
- Bundle inspection confirmed the `https://api.bkper.app` platform endpoint selection and nullable HTTP-404 handling.
- The gate left no tracked working-tree change. The persisted app configuration still routes production events to GCP and developer events to preview.

The pre-deployment portion of Chunk 12 is complete. Before production deployment, commit this evidence and push the exact release revision. The production Worker deployment remains a separate remote mutation requiring the exact command and explicit approval; it must not change the GCP production webhook.

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
- Do not add or sync `webhookUrlDev` until the Worker has passed parity, typecheck, tests, and build.
- Once enabled, `webhookUrlDev` will intentionally route developer-mode events for `*@bkper.com` through the preview Worker. No temporary app identity or additional routing isolation is required.
- Preserve legacy boundary and response behavior throughout the migration. Consider any validation or response hardening only after migration completion as separately approved optional work.
- Pin the Cloudflare migration target to `bkper-js` `2.19.0`: GCP runs `2.18.0`, and `2.19.0` is the smallest version that preserves its nullable-404 behavior while using the platform-authenticated API endpoint. Do not combine migration with the intentional propagated-404 behavior introduced in `2.26.0`.
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
| _No legacy change since the migration baseline_ | Source unchanged through `d0cdf996348150158c8d0e59f32e9c47a2c44555` | N/A | N/A | All 23 baseline production files remain byte-identical after relocation |

### Audit checkpoints

| Checkpoint | Legacy revision reviewed | Reviewer | Result |
| --- | --- | --- | --- |
| Migration baseline | `d1a1bbd8f00281be619cda9d67b4b1d5c13cabc4` | — | Legacy relocation complete; build verified before and after the move |
| Before preview routing | `d0cdf996348150158c8d0e59f32e9c47a2c44555` | AI implementation audit; human owner review pending | Deterministic Chunk 9 audit passed; no legacy drift or missing patch |
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
- Preserve legacy response behavior throughout the migration.

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

### Chunk 10 — Preview deployment readiness and developer-domain canary

**Readiness gate before changing `webhookUrlDev`**

- Full check passes from a clean install.
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

**Outcome: Complete.** The committed preview deployment, authenticated health check, developer webhook routing, isolated Group replay, event response, Worker logs, and zero-movement evidence all passed. The initial dependency-drift failure and its migration-compatible resolution are recorded above.

### Chunk 11 — Deterministic preview validation

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

**Outcome: Complete.** The accepted live evidence covers Group and Account synchronization, same-name non-permanent and many-to-one permanent mappings, complete posted consolidation, visible and trace properties, remote-id uniqueness, and unresolved mapping as an incomplete non-balance-affecting parent draft. Preview logs and event responses contained no errors, and no one-sided posted movement exists.

### Chunk 12 — Final drift audit and production Worker deployment

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

**Pre-deployment gate: Complete.** The final source and deployed-GCP drift audits passed, the clean local and legacy gates passed, and the exact production candidate matches the accepted preview artifact. Production deployment, authenticated health verification, and production log verification remain pending.

### Chunk 13 — Production webhook cutover

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

### Chunk 14 — Stabilization

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

### Chunk 15 — Deferred GCP decommissioning

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

## Optional post-migration work — SDK modernization

Upgrading beyond the migration pin of `bkper-js` `2.19.0` is not a migration completion gate. Consider it only after Cloudflare production stabilization and as a separately approved behavior adaptation.

Before upgrading to a version with propagated HTTP 404 errors:

- Characterize every Account, Group, Transaction, and File lookup that currently uses a missing resource as normal control flow.
- Add focused tests for intentional `BkperError` 404 handling while keeping authentication, permission, network, and server errors observable.
- Adapt both create-versus-update and lookup-fallback branches deliberately; do not broadly swallow API errors.
- Roll the SDK upgrade through preview and deterministic Book evidence independently of the infrastructure migration.

## Optional post-migration work — Boundary and response hardening

This work is not part of the GCP-to-Cloudflare migration and is not a migration completion gate. Consider it only after the migration is complete and the Cloudflare implementation has been fully audited through representative production use.

Any boundary or response change must be proposed, reviewed, tested, and rolled out as a separate behavior change. Before implementation, characterize the production behavior and verify the platform delivery, activity-response, and retry contracts rather than assuming the current app-template conventions apply to this established app.

Possible scope, subject to separate approval:

- Validate missing Books or structurally invalid event payloads at ingress.
- Replace legacy error stacks with safer error messages.
- Define explicit HTTP statuses for invalid payloads and handler/API failures.

Preserve the legacy no-op response for unsupported or irrelevant events unless a separate decision changes it. Tests must first protect current behavior and then prove that approved changes leave valid subscribed events, resource movements, balances, and the zero-sum invariant unaffected. Fixing known business-logic edge cases or adding loop guards remains separate work.
