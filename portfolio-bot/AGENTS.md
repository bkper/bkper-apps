# Portfolio Bot

This directory contains the active full-stack Portfolio Bot Bkper Platform application. Follow [`ROADMAP.md`](./ROADMAP.md) for migration history, parity evidence, rollout records, and deferred legacy retirement. Track accepted post-migration issues in [`BUGS.md`](./BUGS.md).

The previous Google Cloud Function and Google Apps Script source remains recoverable from Git history. Their unchanged deployed runtimes remain available as independent routing rollback targets. Do not modify or delete them without separate explicit approval.

## Current scope

- One Cloudflare Worker serves the bundled client, authenticated `/api/v1/*` routes, `/events`, and `/openapi.json`.
- Cloudflare is production-authoritative for events and the menu. Production and development routing changes remain separate from source changes.
- Preserve the audited migration behavior. Do not combine maintenance with business-logic changes, redesigns, refactors, or optimizations.
- Event dispatch, common orchestration, posted order processing, checked quantity mirroring, transaction lifecycle behavior, Account, Group, and Book synchronization, the typed menu API contract, and pending-calculation Account query are deterministic.
- The client accepts embedded `bkper:app-url-changed` messages only through the established source, origin, shape, and target-App checks. Context changes received during an Account operation remain completely ignored.
- Successful Calculate, Reset, Full Reset, and Forward Date requests return `200 OK` with `{ message: string }`. The message is operation commentary, not a resource receipt. Structured errors retain their separate payload, and Bkper remains the authoritative resource and audit source.
- Keep Book chart loading explicit in each operation facade. Calculate requires complete Portfolio, Financial, and Base charts; Reset and Full Reset require only Portfolio; Forward Date requires Portfolio and Financial, while a distinct Base Book remains metadata-only. Reuse one full Book when Financial and Base share an id.
- Keep account-level Calculate orchestration and `processSale` in `CalculateRealizedResultsService`; retain `CalculateRealizedResultsSupport` and the separate processor. Do not introduce a rules engine, strategy hierarchy, or redesigned calculation pipeline without a separately approved behavior change.
- Keep regular and Full Reset behavior in one service with one retained transaction loop and its existing `full` branches. Keep `ResetRealizedResultsProcessor` separate, and do not deduplicate the immediate sequential Reset used by lower-forward-date repair.
- Keep `ForwardDateService` and its established method boundaries, validation order, queries, recursive lookup, balance reads, relationships, state transitions, mutation order, and failure boundaries. Preserve the immediate history-log post followed by source-Transaction update and the five-second pre-closing delay.
- Protect Bkper's zero-sum invariant above all else. Every posted Transaction must remain one complete movement with one amount from an origin Account to a destination Account. Protect Portfolio, Financial, and Base Books independently; unresolved movements retain their established non-balance-affecting behavior.
- Tests must never use credentials, network access, or live Books.

## Authentication

Create request-scoped `Bkper` instances without OAuth, API-key, or agent-id providers. Platform outbound authentication supplies the event user and App identity. Never read or forward `Authorization`, `bkper-oauth-token`, or `bkper-agent-id` in Worker code.

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

The complete deterministic gate includes generated contracts, strict client and server typechecks, client and server tests, production client and Worker builds, formatting, and generated-file drift checks.

## Rollback and remote operations

Production and developer routing are defined in `bkper.yaml`. Syncing metadata, deploying, configuring secrets, installing or uninstalling the App, replaying events, changing routing, mutating legacy infrastructure, or writing to Books requires explicit approval immediately before the operation.
