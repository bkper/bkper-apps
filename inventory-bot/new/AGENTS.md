# Inventory Bot Cloudflare Migration Target

This directory contains the isolated full-stack Cloudflare migration target for Inventory Bot.

## Current scope

- Chunks 1 through 5 are complete. The production baseline, accepted source-over-deployment COGS deletion hardening, Cloudflare skeleton, common event ingress and resolution boundaries, checked purchase, sale, and credit-note quantity behavior, and transaction lifecycle cleanup are recorded in `../ROADMAP.md`.
- Chunk 6 is next. Complete the event parity and drift audit before beginning menu accounting work.
- The legacy GCP event handler under `../legacy/events/` remains production-authoritative for events.
- The legacy Google Apps Script web app under `../legacy/menu/` remains production-authoritative for the menu.
- One Cloudflare Worker will serve the bundled client, authenticated `/api/v1/*` routes, `/events`, and `/openapi.json`.
- Keep Calculate and Reset non-mutating. Event mutations are limited to the established checked, posting, unchecking, deletion, and linked-cleanup behavior until later roadmap chunks explicitly expand the scope.
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
