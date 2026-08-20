# Portfolio Bot Cloudflare Migration Target

This directory contains the isolated full-stack Cloudflare migration target for Portfolio Bot.

## Current scope

- Chunks 1–9 are complete; Chunk 10 is porting view initialization and validation. The pending-calculation Account query is complete; client context and the remaining validations are not.
- The legacy GCP event handler and Google Apps Script menu under `../legacy/` remain production-authoritative.
- One target Cloudflare Worker will serve the bundled client, authenticated `/api/v1/*` routes, `/events`, and `/openapi.json`.
- Event dispatch, common orchestration, posted order processing, checked quantity mirroring, transaction lifecycle behavior, Account, Group, and Book synchronization, the typed menu API contract, and the pending-calculation Account query are deterministic.
- Preserve the audited legacy accounting behavior during later migration chunks; do not combine migration with business-logic changes, redesigns, refactors, or optimizations.
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
