# Portfolio Bot Cloudflare Migration Target

This directory contains the isolated full-stack Cloudflare migration target for Portfolio Bot.

## Current scope

- Chunks 1–20 are complete and Chunk 21 stabilization is in progress. The event implementation, typed API, Calculate, Reset, Full Reset, Forward Date, lower-date repair, and the responsive operation client are implemented and covered under `new/`. The preview deployment is live with development menu and event routing, developer access is temporarily restricted to the migration operator, authenticated context and controlled event ingress are accepted, unresolved optional Bkper menu expressions are handled at the client URL boundary, and isolated live event validation found no incomplete active movement, duplicate active remote id, reversed persisted movement, partial cleanup, or nonzero per-Book total. The inherited stale restore-commentary behavior is recorded without changing persisted movement semantics. The client now validates trusted embedded `bkper:app-url-changed` messages, reloads the newest idle context without an iframe refresh, and completely ignores context changes while an Account operation is executing. The complete local gate passes with 149 client tests and 187 server tests. The revised candidate is deployed to preview with production routing unchanged. Live embedded context transitions and isolated menu-operation acceptance are complete across combined, fair-only, and historical-only FIFO scenarios; partial-long, complete-long, short-cover, realized, historical, FX, MTM, Reset, Full Reset, Forward Date, lower-date repair, locked, closed, missing-rate, and denied-permission paths retain authoritative movement and no-write evidence. Final cleanup restored the documented active baseline with complete movements, unique remote ids, exact per-Book zero sum, open dates, default model flags, and original permissions and ownership. One Full Reset required replay of a confirmed failed Exchange Bot response after a propagated Base-Book deletion timed out despite the operation returning `200`; rollout monitoring must therefore verify dependent bot responses and authoritative Base-Book state rather than trusting operation success alone. Preview plan availability also blocked one disposable fixture generation before being restored; confirm automation plan availability before canaries and cutovers. Chunk 20 repeated the authoritative GCF and GAS source and deployed-artifact audits, found only the accepted older deployed `GROUP_DELETED` routing difference, reconciled the patch ledger without a new production patch, passed the clean frozen gate with 149 client tests and 187 server tests, reproduced all five deployment artifacts byte-for-byte, and deployed the accepted Worker to production. The production five-path OpenAPI contract, API protection, authenticated client and asset boundary, and request logs are accepted. Production events now route to Cloudflare under the agreed 24-hour read-only stabilization window after the one-hour active window aggregated 1,183 `info`, `ok`, HTTP `200` event requests without a warning, error, non-success request, or rollback indicator. The production menu remains authoritative on GAS, and the unchanged GCP function remains available for immediate event rollback.
- The legacy GCP event handler under `../legacy/` remains the immediate production event rollback target, and the legacy Google Apps Script menu remains production-authoritative.
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
