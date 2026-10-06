# Bookbot plan

Bookbot finds the From and To Accounts and historical properties for transactions. It exposes reusable single and batch discovery for Parser Bot, the Bkper Agent, scripts, and other apps.

Companion plan: [Parser Bot](../../parser-bot/docs/PLAN.md).

## Status

- This directory is an inactive local snapshot of the legacy Bookbot Worker. It is not registered, deployed, or published. `parser-bot/` starts from the same snapshot.
- Phase 1 restarted from the unchanged baseline and has not started. Live migration waits for verification of the legacy Bookbot rename rollout.
- Pushing this repository publishes the source; it requires a final publication review and explicit approval.

## Refactoring rules

- This is a refactoring: preserve the code as much as possible. Change only what a stated boundary goal requires.
- Don't rewrite, fix, rename, reformat, or clean up. Record defects or improvement ideas for a later, separately approved change.
- When extracting, move code verbatim, keeping names, comments, and order.
- Keep diffs small, concise, human-readable, and easy to review: one focused step per commit.
- Add only the characterization tests needed, and keep them short. Existing tests change only mechanically.

## Shared rules

These apply to both apps.

- Preserve Bkper's zero-sum model. Neither app posts transactions; unresolved results remain unposted drafts.
- AI suggests or extracts. Deterministic application code validates, merges, and controls financial writes.
- Reusable APIs return results without Book writes; Book reads and inference are allowed. Event adapters or explicitly authorized callers own persistence.
- API calls need authorization for every target Book, not app installation. Event automation requires installation.
- Target hosting: one ordinary Bkper Platform Worker per app serving `/events`, `/api/v1/*`, and `/openapi.json`.
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

Bookbot does not handle file or transaction-created events in the target design. Parser Bot calls Bookbot discovery before recording imports and when enriching created transactions. Until Phase 3/4, this snapshot retains the legacy handlers for all current events.

## Properties

| Properties | Role |
| --- | --- |
| `agent_credit_account_id_`, `agent_debit_account_id_`, `agent_description_part_`, `agent_discovered_properties_`, plus discovered visible properties | Discovery results and provenance on drafts. Bookbot writes them; Parser Bot learning reads the account-side provenance. |
| `agent_discovery_examples` | Discovery configuration (Account, then Group, then Book). |
| `agent_excluded_properties`, legacy `agent_prompt_skip` | Exclusions shared with Parser Bot learning. Both read; neither writes. |
| `parsed_account_name_` | Produced by Parser Bot extraction; consumed and removed locally by discovery. |

## Discovery contract (Phase 2)

Bookbot provides this contract; Parser Bot consumes it.

- Versioned `/api/v1/*` operations with a published `/openapi.json` and generated client types.
- Single and batch calls share one item contract and implementation. Stable client item identifiers correlate results.
- Inputs identify the target Book and include transaction context, known account sides, description and hashtags, relevant properties, and optional verified creator or source context. Do not trust caller-supplied identities to select permissions or an execution principal.
- Outputs include suggested account sides, proposed historical properties, an outcome, and bounded provenance. Report no-change separately from no-match, and both separately from dependency failures. Do not present frequency counts as calibrated confidence.
- Validate that suggested Accounts belong to the authorized target Book. Preserve known sides and supplied properties.
- Use one request-scoped discovery context per target Book to retain cache benefits. Bound batch size, concurrency, and time; choose limits from measured behavior.
- Do not expose raw SDK objects, private event payloads, or full historical datasets.

To agree before implementation: endpoint names, item/result/error shapes, batch limits, caller and app-chain attribution, and AI allowance attribution.

## Phase 1 steps

Work only in `bookbot/`, on code Bookbot owns. Non-owned code stays identical to `baseline-manifest.json`.

Characterize first. Each test must pass against unchanged code:

- **B1.** A description-part extraction failure returns `discovered: false` without throwing, and the earlier local removal of `parsed_account_name_` remains. A failed history query is treated as empty, and the search continues.
- **B2.** Rediscovery guards: no account change, or a change not made by discovery, returns `null`; a backlog over 50 returns before listing drafts; only the first 100 drafts are considered.
- **B3.** The posted/updated adapter ignores unposted transactions and passes the rediscovery result through.

Then refactor:

- **B-R1.** Type discovery's dependency as the narrow `DiscoveryDependencies` contract that `AppContext` satisfies.
- **B-R2.** Name the existing result shape `DiscoveryOutcome`.
- **B-R3.** The event adapter passes a typed `AccountCorrection` to rediscovery instead of the raw event. Rediscovery otherwise keeps `AppContext`.
- **B-R4.** Split rediscovery into `findRediscoveredDrafts`, which changes drafts in memory only, and `rediscover`, which persists them with the same batch write, message, and logs. One test verifies the finder does not persist.

Known current behavior to preserve and resolve in later phases:

- Dependency failures in discovery look the same as no match. The API must report them distinctly.
- In the legacy posted/updated handler, a rejected learning or rediscovery task fails the combined event result.

## Phases

1. **Boundaries and characterization.** Follow the Phase 1 steps above. Done when the characterization tests pass, the four refactors are complete, existing assertions are unchanged, non-owned code still matches the baseline, and `bun run test` passes.
2. **Discovery API.** Implement the agreed contract on the existing behavior. Keep legacy event behavior working. Prepare the platform deployment and authentication migration separately from algorithm changes. Exercise direct and delegated callers, authorization failures, no-match, and dependency failures in preview.
3. **Parser Bot integration.** After Parser Bot consumes the API, remove parsing, attachment, import, and learning code from this directory.
4. **Event migration.** Move file, attachment, and learning events to Parser Bot without duplicate processing; keep rediscovery here.
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
