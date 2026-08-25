# Portfolio Bot Cloudflare Migration Target

This directory contains the isolated full-stack Cloudflare migration target for Portfolio Bot.

## Current scope

- Chunks 1–11 are complete; Chunk 12 subchunks 1–3 have ported the regular batched Reset internals without route wiring. Subchunk 4 extends the retained loop with Full Reset parity only, keeping both operation stubs non-mutating and leaving response tracking, schema changes, route wiring, and facade integration untouched. Subchunk 5 reviews the response contracts and wires both operations before Calculate in Chunk 13 because the legacy Calculate rebuild branch invokes regular Reset and returns. The pending-calculation API enforces view permission and Portfolio Bot installation, and every mutation stub resolves and preflights its Portfolio, Financial, and Base Book context. Legacy pending-task validation occurs only after an operation click and remains planned with the Chunk 15 operation-batch client.
- The legacy GCP event handler and Google Apps Script menu under `../legacy/` remain production-authoritative.
- One target Cloudflare Worker will serve the bundled client, authenticated `/api/v1/*` routes, `/events`, and `/openapi.json`.
- Event dispatch, common orchestration, posted order processing, checked quantity mirroring, transaction lifecycle behavior, Account, Group, and Book synchronization, the typed menu API contract, and the pending-calculation Account query are deterministic.
- Preserve the audited legacy accounting behavior during later migration chunks; do not combine migration with business-logic changes, redesigns, refactors, or optimizations.
- Preserve the legacy file, class, function, branch, lookup, relationship, and mutation order during menu operation ports wherever target-runtime adaptation permits. Use committable behavioral test slices, not architectural extraction, to port large methods.
- Keep parity migration and target-server integration in separate subchunks for Reset, Calculate, and Forward. Parity subchunks must leave API facades, response schemas, routes, generated contracts, and non-mutating operation stubs unchanged. Review response contracts and wire migrated behavior only in each operation's dedicated subsequent integration subchunk.
- For Calculate specifically, any `api/services/calculate/` subdirectory is organizational only. Keep `CalculateRealizedResultsService.processSale` as one method during migration, retain the existing helper-method boundaries and separate processor class, and do not introduce a new rules engine, strategy hierarchy, or redesigned calculation pipeline.
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
