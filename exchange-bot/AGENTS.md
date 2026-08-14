# Exchange Bot

This directory contains the active full-stack Exchange Bot Bkper Platform application.

## Current scope

- One Cloudflare Worker serves the bundled client, authenticated `/api/v1/*` routes, `/events`, and `/openapi.json`.
- Cloudflare is production-authoritative for both events and the menu. Production and development routing changes remain separate from source changes.
- The previous GCP and Google Apps Script source is recoverable from Git history. Their deployed runtimes remain available as independent routing rollback targets until separately retired.
- Preserve the audited migration behavior. Do not combine maintenance with business-logic changes, redesigns, refactors, or optimizations.
- Protect Bkper's zero-sum invariant above all else. Every posted transaction must remain one complete movement with one amount from an origin Account to a destination Account; unresolved movements retain their established non-balance-affecting behavior.
- Tests must never write to live Books.

## Local development

- Vite client: `5177`
- Worker: `8793`

```bash
bun install
bun run dev
```

## Verification

```bash
bun run check
```

The complete deterministic gate includes generated contracts, strict typechecks, client and server tests, production client and Worker builds, formatting, and generated-file drift checks.

Do not sync, deploy, configure secrets, install or uninstall the app, replay events, change routing, mutate legacy infrastructure, or write to Books without separate explicit approval.
