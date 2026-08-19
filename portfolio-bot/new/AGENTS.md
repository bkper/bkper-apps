# Portfolio Bot Cloudflare Migration Target

This directory contains the isolated full-stack Cloudflare migration target for Portfolio Bot.

## Current scope

- Chunks 1–5 are complete; Chunk 6 will port transaction update, uncheck, delete, and restore behavior.
- The legacy GCP event handler and Google Apps Script menu under `../legacy/` remain production-authoritative.
- One target Cloudflare Worker will serve the bundled client, authenticated `/api/v1/*` routes, `/events`, and `/openapi.json`.
- Event dispatch, common orchestration, posted order processing, and checked quantity mirroring are deterministic. Transaction lifecycle and resource synchronization handlers remain explicit no-op behavior stubs until their behavior chunks.
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
