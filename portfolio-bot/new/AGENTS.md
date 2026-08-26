# Portfolio Bot Cloudflare Migration Target

This directory contains the isolated full-stack Cloudflare migration target for Portfolio Bot.

## Current scope

- Chunks 1–12 are complete, and Chunk 13 Subchunks 1–4 have established the minimal Calculate constants, types, `StockAccount` support, required `BotService` behavior, ordered mutation processor, and existing helper behavior. Subchunk 5 has separated that unchanged helper behavior into `CalculateRealizedResultsSupport` and reserved `CalculateRealizedResultsService` for account-level orchestration and the intact `processSale` method. `processSale`, Calculate orchestration, and the API remain unwired; the legacy rebuild branch will invoke the already ported regular Reset and return. The pending-calculation API enforces view permission and Portfolio Bot installation, and every mutation operation resolves and preflights its Portfolio, Financial, and Base Book context. Legacy pending-task validation occurs only after an operation click and remains planned with the Chunk 15 operation-batch client.
- The legacy GCP event handler and Google Apps Script menu under `../legacy/` remain production-authoritative.
- One target Cloudflare Worker will serve the bundled client, authenticated `/api/v1/*` routes, `/events`, and `/openapi.json`.
- Event dispatch, common orchestration, posted order processing, checked quantity mirroring, transaction lifecycle behavior, Account, Group, and Book synchronization, the typed menu API contract, and the pending-calculation Account query are deterministic.
- Preserve the audited legacy accounting behavior during later migration chunks; do not combine migration with business-logic changes, redesigns, refactors, or optimizations.
- Preserve the legacy file, class, function, branch, lookup, relationship, and mutation order during menu operation ports wherever target-runtime adaptation permits. Use committable behavioral test slices, not architectural extraction, to port large methods.
- Keep parity migration and target-server integration in separate subchunks for Reset, Calculate, and Forward. Parity subchunks must leave API facades, response schemas, routes, generated contracts, and non-mutating operation stubs unchanged. Apply the accepted API contract and wire migrated behavior only in each operation's dedicated subsequent integration subchunk.
- Keep Book chart loading explicit in each operation facade after common context validation. Calculate requires complete Portfolio, Financial, and Base charts; Reset and Full Reset require only Portfolio; Forward Date requires Portfolio and Financial, while a distinct Base Book remains metadata-only. Reuse one full Book when Financial and Base share an id.
- Successful Calculate, Reset, Full Reset, and Forward Date requests return `200 OK` with the shared `{ message: string }` response; structured errors retain their separate payload. The message is operation commentary, not a resource receipt. Do not add resource receipts or response tracking to parity accounting code without a concrete consumer requirement. Bkper remains the authoritative resource and audit source.
- For Calculate specifically, `api/services/calculate/` is organizational only. Keep account-level orchestration and `processSale` in `CalculateRealizedResultsService`, keep `processSale` as one method during migration, and keep the already-ported helper methods unchanged in the composed `CalculateRealizedResultsSupport`. Retain the separate processor class, and do not introduce a new rules engine, strategy hierarchy, or redesigned calculation pipeline.
- For Reset specifically, any `api/services/reset/` subdirectory is organizational only. Keep the batched Reset and Full Reset behavior in one service with one retained transaction loop and its existing `full` branches, keep `ResetRealizedResultsProcessor` separate, and do not extract cleanup strategies or pipelines. Chunk 12 ports the batched implementation used by Reset, Full Reset, and Calculate; the separate immediate and sequential implementation used only by lower-forward-date repair remains in Chunk 14 and must not be deduplicated during migration.
- For Forward specifically, the `api/services/forward/` subdirectory is organizational only. Keep `ForwardDateService` and its existing method boundaries, do not introduce a processor, and preserve every validation, query, recursive lookup, balance read, property, relationship, state transition, no-op, delay, mutation, failure boundary, and return outcome. Preserve the immediate history-log post then source-Transaction update sequence and the five-second pre-closing delay; intercept the delay deterministically in tests rather than removing it during migration.
- Protect Bkper's zero-sum invariant above all else. Every posted transaction must remain one complete movement with one amount from an origin Account to a destination Account; unresolved movements retain their established non-balance-affecting behavior.
- Tests must never write to live Books.

## Local development

- Vite client: `5179`
- Worker: `8797`

```bash
bun install
bun run dev
```

## Verification

```bash
bun run check
```

The complete deterministic gate will include generated contracts, strict typechecks, client and server tests, production client and Worker builds, formatting, and generated-file drift checks.

Do not sync, deploy, configure secrets, install or uninstall the app, replay events, change routing, mutate legacy infrastructure, or write to Books without separate explicit approval.
