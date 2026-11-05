# Bookbot plan

Bookbot finds the From and To Accounts and historical properties for transactions. It exposes reusable single and batch discovery for Parser Bot, the Bkper Agent, scripts, and other apps.

Companion plan: [Parser Bot](../../parser-bot/docs/PLAN.md).

## Status

- This directory is the Platform Bookbot, started from a snapshot of the legacy Bookbot Worker; `parser-bot/` starts from the same snapshot. Preview (2026-10-16) and production (2026-10-30) deployments serve the discovery API at `bookbot-preview.bkper.app` and `bookbot.bkper.app`. Since the 2026-11-03 cutover (Phase 4 step 1), production receives all `bookbot` Book events with unchanged legacy behavior, and preview receives development-mode events. This directory is the source of truth for the `bookbot` registration; never sync from the legacy repository.
- Phase 1 discovery API is implemented, tested against preview and deployed. Known API defects are recorded in [DEFERRED.md](DEFERRED.md). Platform hosting: `bkper.yaml` and Platform event authentication. Since the 2026-11-05 handover, Bookbot handles only posted/updated events (rediscovery) and the discovery API; its document reading, attachment, import and learning code was removed afterwards. The legacy Bookbot rename rollout is verified.
- Pushing this repository publishes the source; it requires a final publication review and explicit approval.

## Refactoring rules

- Goal: split the two apps into isolated business processes with the least code change possible. Current behavior works; don't break it.
- Don't rewrite, fix, rename, reformat, or clean up. Record defects or ideas for a separate, approved change.
- Move code verbatim, keeping names, comments, and order.
- Keep diffs small and easy to review: one focused step per commit.
- Before changing behavior that tests don't cover, add a short test of the current behavior. Existing tests change only mechanically.

Shared rules, responsibilities, events, properties, the discovery API and known current behavior are in [AGENTS.md](../AGENTS.md).

## Phases

Both plans use the same phases.

1. **Bookbot discovery API.** Wrap the existing discovery code in the API above without changing its default behavior. Keep legacy events working. Platform hosting is prepared separately from any algorithm change: a local `bkper.yaml` (`deployment.server: src/index.ts`, legacy events and properties until Phase 4) and Platform event authentication. Flat `src/` layout and Wrangler dry-run build are retained until Phase 5.
2. **Parser Bot API.** Done in Parser Bot; this directory is unchanged.
3. **Parser Bot uses Bookbot.** Done in Parser Bot; this directory keeps its legacy handlers working.
4. **Event migration.** **Handover done on 2026-11-05 at 13:41 UTC** (Phase 4 step 2): Parser Bot handles file, created, posted/updated (learning), deleted and audit events; Bookbot handles only posted/updated events (rediscovery) and the discovery API. Cleanup done after the handover: document reading, attachments, imports, learning code and their tests were removed from Bookbot (43 source files; `PromptLookupService` and `AppContext` trimmed to discovery; `@typesafe-ai/sdk` dropped). Remaining: publication review and the legacy Worker's retirement. Original scope: move file, attachment, and learning events to Parser Bot without duplicate processing. Handover deliverable: rewrite Bookbot's README for its new job (account discovery, rediscovery after account corrections, and the discovery API) and sync it at the handover. Parser Bot's README was synced earlier, on 2026-11-04 when Parser Bot was published, so until the handover the two listings overlap: Bookbot's README still describes document extraction, which Bookbot still performs. Only after Parser Bot continuity is verified, remove parsing, attachment, import, and learning code from this directory; keep rediscovery. Prerequisite: Parser Bot no longer rediscovers drafts (removed in Phase 3), so this Bookbot must handle `TRANSACTION_POSTED`/`TRANSACTION_UPDATED` rediscovery for real Book events before Parser Bot takes over events from the legacy Worker. Step 1 (production events on the Platform Bookbot) was done on 2026-11-03. Gate before step 2: review the production Bookbot event logs since the 2026-11-03 cutover (`bkper app logs bookbot --events`): HTTP status and error rate, timeouts or slow statement imports, `BOOK_AUDITED` runs, and any behavior differences from the legacy Worker. Proceed only if they are clean; otherwise fix or roll back first. Gate passed on 2026-11-03 at the user's request after 68 minutes (not 24 hours) of production traffic: 3,552 events, all HTTP 200, p99 4 s, slowest 232 s (a learning audit, no timeout); the two error responses were a customer's external parser configuration and the `account_name` defect in DEFERRED.md, both existing behavior.
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
