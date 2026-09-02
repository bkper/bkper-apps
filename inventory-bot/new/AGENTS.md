# Inventory Bot Cloudflare Migration Target

This directory contains the isolated full-stack Cloudflare migration target for Inventory Bot.

## Current scope

- Chunk 1 is complete. The production baseline and accepted source-over-deployment COGS deletion hardening are recorded in `../ROADMAP.md`.
- Chunk 2 is in progress. Establish only the runnable, non-mutating full-stack skeleton under `new/`.
- The legacy GCP event handler under `../legacy/events/` remains production-authoritative for events.
- The legacy Google Apps Script web app under `../legacy/menu/` remains production-authoritative for the menu.
- One Cloudflare Worker will serve the bundled client, authenticated `/api/v1/*` routes, `/events`, and `/openapi.json`.
- Keep Calculate, Reset, and all four subscribed event handlers non-mutating during Chunk 2.
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
