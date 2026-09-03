# Inventory Bot Cloudflare Migration Target

This directory contains the isolated full-stack Cloudflare migration target for Inventory Bot.

## Current scope

- Chunks 1 through 3 are complete. The production baseline, accepted source-over-deployment COGS deletion hardening, non-mutating Cloudflare skeleton, and common event ingress and resolution boundaries are recorded in `../ROADMAP.md`.
- Chunk 4 is next. Port checked purchase, sale, and credit-note quantity behavior while preserving the established movement semantics and zero-sum invariant.
- The legacy GCP event handler under `../legacy/events/` remains production-authoritative for events.
- The legacy Google Apps Script web app under `../legacy/menu/` remains production-authoritative for the menu.
- One Cloudflare Worker will serve the bundled client, authenticated `/api/v1/*` routes, `/events`, and `/openapi.json`.
- Keep Calculate and Reset non-mutating. During Chunk 4, introduce business mutations only in the checked-transaction path; keep the other subscribed event handlers non-mutating until Chunk 5.
- Do not inherit Portfolio Bot domain behavior, routes, event subscriptions, operation policies, or UI workflows.
- Protect Bkper's zero-sum invariant above all else. Every posted Transaction must remain one complete movement with one amount from an origin Account to a destination Account.
- Tests must never write to live Books.

## Local development

- Vite client: `5175`
- Worker: `8796`

```bash
bun install
bun run dev
```

## Verification

```bash
bun run check
```

The deterministic gate includes generated contracts, strict typechecks, client and server tests, production client and Worker builds, formatting, and generated-file drift checks.

Do not sync, deploy, install or uninstall the app, replay events, change routing, mutate legacy infrastructure, or write to Books without separate explicit approval.
