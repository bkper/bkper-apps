# Parser Bot plan

Parser Bot extracts transaction fields and file metadata from documents, statements, attachments, and descriptions. It records imports as unposted drafts, uses Bookbot for account discovery, and learns from extraction corrections.

Companion plan: [Bookbot](../../bookbot/docs/PLAN.md). The shared rules and the discovery API Parser Bot consumes are in [Bookbot's AGENTS.md](../../bookbot/AGENTS.md).

## Status

- This directory started as a snapshot of the legacy Bookbot Worker. The app ID `parser-bot` was confirmed on 2026-10-30 and registered on 2026-11-03 (unpublished). Preview is deployed and installed only on a dedicated test Book; production is not deployed and the app is not installed in other Books.
- Phase 1 discovery API is implemented locally in Bookbot. Phase 2 is implemented locally: `POST /api/v1/parse`, `/openapi.json`, and generated canonical client types are available. Platform hosting is prepared locally: `bkper.yaml` and Platform event authentication. Phase 3 is implemented and verified on preview: file-import and transaction-created handlers call Bookbot's discovery API instead of local discovery. Other legacy event behavior is unchanged. Live migration waits for verification of the legacy Bookbot rename rollout.
- Local verification passed: dry-run build, source/test typechecks, API contract freshness, 539 deterministic tests, Git-flow regressions, and a frozen-lockfile install with scripts disabled. The 22 live tests remain skipped; no live inference or Book writes were run.
- Pushing this repository publishes the source; it requires a final publication review and explicit approval.

## Refactoring rules

- Goal: split the two apps into isolated business processes with the least code change possible. Current behavior works; don't break it.
- Don't rewrite, fix, rename, reformat, or clean up. Record defects or ideas for a separate, approved change.
- Move code verbatim, keeping names, comments, and order.
- Keep diffs small and easy to review: one focused step per commit.
- Before changing behavior that tests don't cover, add a short test of the current behavior. Existing tests change only mechanically.

Responsibilities, events, properties, the parse API and known current behavior are in [AGENTS.md](../AGENTS.md).

## Agreed policies for migration

- **Discovery outage:** do not discard successful parsing. Record parsed items as unposted drafts, preserve supplied fields, and report the discovery failure distinctly. Valid no-match may also produce unposted drafts. Authorization or persistence failure still blocks that target write, and partial results identify what was actually recorded.
- **Installation:** Books currently receiving parsing through Bookbot receive Parser Bot automatically during the separately approved migration. First resolve the installation principal, permissions, AI allowance, and duplicate-processing safeguards.
- Before cutover, specify idempotency, partial-batch and cross-Book recovery, stale-update protection, summary completion, and replay behavior. Never enable legacy and Parser Bot processing for the same events or reprocess recorded imports blindly.

## Phases

Both plans use the same phases.

1. **Bookbot discovery API.** Done in Bookbot; this directory is unchanged.
2. **Parser Bot API.** Implemented locally. App ID `parser-bot` confirmed; not registered yet. `/api/v1/parse` wraps the existing file router, attachment extraction, and amount/date extractors; `/openapi.json` and `bun run api` / `api:check` maintain generated client types and the contract snapshot. Composed parse-and-discover and batch requests are deferred. The two necessary moves are complete:
   - Moved the attachment extraction methods (`extractAttachedTransaction`, `resolveTransactionParserAccount`, `extractFilePropertiesIfConfigured`, `filterFileProperties`, `shouldSkipFileProperty`) verbatim from `EventHandlerTransactionCreated` into `AttachmentExtractionService`; only the two extraction entry points are public. The handler retains merging, concurrent calls, discovery, writes, and error handling.
   - Moved `migrateLegacyPromptProperties` and its constant verbatim into `LegacyPromptPropertyMigration`, injected into `PromptLookupService` with the persisting one as default. The API supplies a non-persisting implementation.
   - Small API-only controls suppress private prompt/context logging, propagate amount/date failures, attribute inference to Parser Bot, and pass request cancellation to external parsers. Default event behavior remains unchanged; the two file-property filters remain distinct.
3. **Parser Bot uses Bookbot.** Implemented; verified on preview on 2026-11-03 and 2026-11-04: CSV statement and PDF invoice imports, created transactions with and without an attachment, invoice learning after a posted correction, statement flagging after a deletion, automatic audits and a manually triggered audit that ran statement learning on a flagged Account, and the authenticated parse API (no writes). Since P1 (2026-11-04), Parser Bot's registration listens to no events until the Phase 4 handover. A live external parser call was not tested; that code matches the one running in production Bookbot. Local discovery code removed afterwards. Prerequisite done: both apps are standard Platform apps (local `bkper.yaml` with `deployment.server: src/index.ts`, legacy events and properties until Phase 4, and Platform event authentication; flat `src/` layout and Wrangler dry-run build retained until Phase 5). Parser Bot calls Bookbot with a plain `fetch`; Platform outbound delegates user or event context without exposing credentials (app chain, loop and hop limits enforced by Dispatch). Both Parser Bot environments call only `https://bookbot.bkper.app/api/v1/*` (switched from `bookbot-preview` on 2026-11-04, after production Bookbot took over all Bookbot events; the legacy Worker is only a rollback target and is never called). The address is one constant. Local development cannot make app-to-app calls (the CLI's local outbound authorizes only the Bkper API and Bkper AI), so local tests use a Bookbot client double; integration runs on Parser Bot preview against a dedicated test Book where only Parser Bot is installed, never alongside the legacy Bookbot. `BookbotDiscoveryClient` sends one batch per target Book (file imports, with the upload Account as `sourceAccount`) or one item (created transactions), applies only Account sides and properties, and keeps every other extracted field. Failed or unreachable discovery still records unposted drafts and returns a `warning` naming the failure; cancellation propagates. Event-path discovery inference now runs in Bookbot and is attributed to it; Parser Bot's own inference is attributed to `parser-bot`. Bookbot's contract is copied to `src/clients/bookbot/openapi.json`; `bun run api` generates its types. Local `DiscoveryService`, `RediscoveryService` and `ExtractorDescriptionParts` were removed after the preview verification; their tests remain in Bookbot. The posted/updated handler now runs only extraction learning. Integrate against Bookbot's actual discovery API and verify that boundary before removing local discovery and rediscovery. Keep property names and external parser contracts compatible.
4. **Event migration.** **Handover done on 2026-11-05 at 13:41 UTC** (Phase 4 step 2): Parser Bot handles file, created, posted/updated (learning), deleted and audit events; Bookbot handles only posted/updated events (rediscovery) and the discovery API. Remaining: remove document reading, attachments, imports and learning code from Bookbot, then publication review and the legacy Worker's retirement. Parser Bot was published and its user-facing README synced on 2026-11-04; its registration still listens to no events. At the handover, sync Bookbot's rewritten README. Apply the agreed policies with a controlled rollout and a rollback that never reprocesses recorded imports blindly. Parser Bot no longer rediscovers drafts after Account corrections, so Bookbot's rediscovery must handle real Book events before Parser Bot takes over events from the legacy Worker. Gate before step 2: review the production Bookbot event logs since the 2026-11-03 cutover (`bkper app logs bookbot --events`): HTTP status and error rate, timeouts or slow statement imports, `BOOK_AUDITED` runs, and any behavior differences from the legacy Worker. Proceed only if they are clean; otherwise fix or roll back first. Gate passed on 2026-11-03 at the user's request after 68 minutes (not 24 hours) of production traffic: 3,552 events, all HTTP 200, p99 4 s, slowest 232 s (a learning audit, no timeout); the two error responses were a customer's external parser configuration and the `account_name` defect in DEFERRED.md, both existing behavior.
5. **Publication.** Final license, security, fixture, and documentation review; `bkper.yaml`, README, and delivery workflow; explicit approval before pushing.

## Verification

- Invoice, receipt, statement, CSV, image, attachment, metadata, external parser, and description extraction behavior.
- Parser-to-Bookbot contract compatibility and outage handling.
- Extraction learning separate from account rediscovery, including legacy transactions and lookup precedence.
- Event loop prevention, duplicate deliveries, retries, stale snapshots, and preservation of user corrections.
- Cross-Book import recovery and truthful summaries with native IDs only after recording.
- Typechecks, contract freshness, deterministic tests, and production builds every phase. Tests use doubles and synthetic fixtures; live Books and paid inference require explicit approval.

## Deferred

New extraction features, automatic posting, logo redesign, and durable background processing without demonstrated need.
