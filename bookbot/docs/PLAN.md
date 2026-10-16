# Bookbot plan

Bookbot finds the From and To Accounts and historical properties for transactions. It exposes reusable single and batch discovery for Parser Bot, the Bkper Agent, scripts, and other apps.

Companion plan: [Parser Bot](../../parser-bot/docs/PLAN.md).

## Status

- This directory is an inactive local snapshot of the legacy Bookbot Worker. It is not registered, deployed, or published. `parser-bot/` starts from the same snapshot.
- Phase 1 discovery API is implemented locally. Platform hosting is prepared locally: `bkper.yaml` and Platform event authentication. Legacy event behavior remains in place; event migration has not started. Live migration waits for verification of the legacy Bookbot rename rollout.
- Pushing this repository publishes the source; it requires a final publication review and explicit approval.

## Refactoring rules

- Goal: split the two apps into isolated business processes with the least code change possible. Current behavior works; don't break it.
- Don't rewrite, fix, rename, reformat, or clean up. Record defects or ideas for a separate, approved change.
- Move code verbatim, keeping names, comments, and order.
- Keep diffs small and easy to review: one focused step per commit.
- Before changing behavior that tests don't cover, add a short test of the current behavior. Existing tests change only mechanically.

## Shared rules

These apply to both apps.

- Preserve Bkper's zero-sum model. Neither app posts transactions; unresolved results remain unposted drafts.
- AI suggests or extracts. Deterministic application code validates, merges, and controls financial writes.
- Reusable APIs return results without Book writes; Book reads and inference are allowed. Event adapters or explicitly authorized callers own persistence.
- API calls need authorization for every target Book, not app installation. Event automation requires installation.
- Hosting: one standard Bkper Platform app per app serving `/events`, `/api/v1/*`, and `/openapi.json`. Event and API code use `new Bkper()` with Platform outbound authentication. Parser Bot calls Bookbot with a plain `fetch` to `https://bookbot.bkper.app/api/v1/*`; Platform outbound delegates user or event context without exposing credentials.
- Preserve explicitly supplied accounts and properties, existing `agent_*` properties, and legacy provenance.
- Do not log credentials, document content, transaction descriptions, or private Book data.

## Responsibilities

Bookbot owns:

- Account discovery from description, hashtags, a known account, and posted history.
- Discovery of common historical properties and its provenance.
- Rediscovery of affected pending drafts after a discovered account is corrected, including persisting those updates.

Parser Bot owns parsing, description field extraction, file metadata, external parsers, imports, attachments, summaries, and extraction learning.

## Events

| Event | Bookbot target behavior |
| --- | --- |
| `TRANSACTION_POSTED` / `TRANSACTION_UPDATED` | Rediscover pending drafts when a discovered account was corrected. Parser Bot also subscribes for extraction learning. |

Bookbot does not handle file or transaction-created events in the target design. Parser Bot calls Bookbot discovery before recording imports and when enriching created transactions. Until Phase 4, this snapshot retains the legacy handlers for all current events.

## Properties

| Properties | Role |
| --- | --- |
| `agent_credit_account_id_`, `agent_debit_account_id_`, `agent_description_part_`, `agent_discovered_properties_`, plus discovered visible properties | Discovery results and provenance on drafts. Bookbot produces them; whoever records the draft persists them (Parser Bot for imports and created transactions, Bookbot for rediscovery). Parser Bot statement learning reads the account-side provenance. |
| `agent_discovery_examples` | Discovery configuration (Account, then Group, then Book). |
| `agent_excluded_properties`, legacy `agent_prompt_skip` | Exclusions shared with Parser Bot learning. Both read; neither writes. |
| `parsed_account_name_` | Set by Bkper when a created transaction's description names one Account. Discovery uses it as the known Account and removes it locally; Parser Bot prompt and parser-URL lookup also reads it. |

## Discovery API (Phase 1)

Bookbot provides this API; Parser Bot consumes it.

- Versioned `/api/v1/*` operations with a published `/openapi.json` and generated client types.
- Single and batch calls share one item contract and implementation. Stable client item identifiers correlate results.
- Inputs identify the target Book and include transaction context, known account sides, description and hashtags, relevant properties, and optional verified creator or source context. Do not trust caller-supplied identities to select permissions or an execution principal.
- Outputs include suggested account sides, proposed historical properties, an outcome, and bounded provenance. Report no-change separately from no-match, and both separately from dependency failures. Do not present frequency counts as calibrated confidence.
- Validate that suggested Accounts belong to the authorized target Book. Preserve known sides and supplied visible properties. Return the existing discovery `.json()`, including consumed `parsed_account_name_` context and updated internal `agent_*` provenance.
- Use one request-scoped discovery context per target Book to retain cache benefits. Preserve baseline sequential processing, caches and the existing external-request limit; honor request cancellation. No new batch-size, concurrency or deadline controls are introduced in this refactoring.
- Do not expose raw SDK objects, private event payloads, or full historical datasets.

### Agreed Phase 1 contract

- `POST /api/v1/discovery` accepts `{ itemId, bookId, transaction, sourceAccount? }`; batch at `POST /api/v1/discovery/batch` accepts `{ items: [...] }` with unique client item IDs.
- `transaction` is canonical `bkper.Transaction`; `sourceAccount` is canonical `bkper.Account` and enables property enrichment from the history found by account discovery. Account context requires an ID; other resource metadata is not trusted for authorization or configuration.
- Each result is `{ itemId, bookId, transaction, outcome, error? }`, where outcome is `changed`, `no_change`, `no_match` or `error`, and error is `{ code, message }`. Valid requests return HTTP 200 with per-item outcomes, including partial-batch failures; invalid requests return HTTP 400. No-change means both Account sides are supplied or the description is blank. No-match means no Accounts were discovered. Failed items return their original supplied transaction, not partial suggestions.
- Platform bearer authentication and outbound authorization are used. Each target Book requires `VIEWER`, `POSTER`, `EDITOR` or `OWNER`; installation is not required for API calls. Legacy event authentication is unchanged.
- The Platform owns caller/app-chain attribution. Discovery inference is attributed to Bookbot and uses the allowance of the authenticated principal, including their Business-domain pool where applicable. Caller-supplied identity never chooses permissions or allowance.
- `transaction.createdBy` is used as a lookup hint only when verified against the authenticated user or an existing transaction in the target Book. Otherwise it is excluded from lookup but preserved in the returned payload.
- `/openapi.json` defines the contract; `src/api/generated/types.d.ts` references canonical Bkper resource types. `bun run api` regenerates types and the reviewed contract snapshot; `bun run api:check` checks freshness.

## Known current behavior

- Discovery reads Books and runs inference but persists nothing. The API reuses `Discovery.discover` and `Discovery.discoverProperties` without algorithm changes.
- Legacy dependency failures resemble no-match: discovery catches failures, a failed history query counts as empty, and the concrete description extractor catches inference failures and returns empty parts (so fallback searches can still match). Optional error hooks propagate these failures only for API callers; default event behavior is unchanged. See [deferred behavior](DEFERRED.md).
- Rediscovery returns `null` when no account changed or the change was not made by discovery, stops when the backlog exceeds 50, and considers one `is:draft` query with limit 100.
- The legacy posted/updated handler runs learning and rediscovery together; one rejection fails the combined result.

## Phases

Both plans use the same phases.

1. **Bookbot discovery API.** Wrap the existing discovery code in the API above without changing its default behavior. Keep legacy events working. Platform hosting is prepared separately from any algorithm change: a local `bkper.yaml` (`deployment.server: src/index.ts`, legacy events and properties until Phase 4) and Platform event authentication. Flat `src/` layout and Wrangler dry-run build are retained until Phase 5.
2. **Parser Bot API.** Done in Parser Bot; this directory is unchanged.
3. **Parser Bot uses Bookbot.** Done in Parser Bot; this directory keeps its legacy handlers working.
4. **Event migration.** Move file, attachment, and learning events to Parser Bot without duplicate processing. Only after Parser Bot continuity is verified, remove parsing, attachment, import, and learning code from this directory; keep rediscovery.
5. **Publication.** Final license, security, fixture, and documentation review; `bkper.yaml`, README, and delivery workflow; explicit approval before pushing.

## Verification

- Single/batch equivalence, result correlation, cache isolation, and bounded requests.
- Known account and property preservation, target-Book account membership, and no Book writes from API handlers, including failed or cancelled requests.
- No-match, no-change, and dependency-error distinction, with safe partial-batch results.
- Caller authorization, app identity, and AI allowance behavior.
- Rediscovery separate from extraction learning, including legacy provenance; duplicate deliveries and stale snapshots must not overwrite user corrections.
- Typechecks, contract freshness, deterministic tests, and production builds every phase. Tests use doubles and synthetic fixtures; live Books and paid inference require explicit approval.

## Deferred

New discovery algorithms, calibrated confidence, automatic posting, logo redesign, and durable background processing without demonstrated need.
