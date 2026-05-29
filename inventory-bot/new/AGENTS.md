# Inventory Bot Platform App

## Overview

This is the new Bkper Platform version of Inventory Bot.

Current migration scope:

- The platform client/menu and server API are being migrated first.
- Production `menuUrl` still points to the legacy Google Apps Script menu.
- Production `webhookUrl` still points to the legacy Google Cloud Function event handler.
- Platform `/events` is intentionally a no-op dispatcher until the legacy event logic is explicitly migrated.

## Structure

```txt
client/
├── index.html
└── src/
    ├── components/   — Lit menu UI
    ├── index.ts
    └── types.ts      — client DTOs shared with API responses

server/
├── src/
│   ├── index.ts      — single Worker: /api/*, /events, health, static assets
│   ├── events/       — no-op platform event dispatcher for this phase
│   └── shared/       — server-side Inventory Bot constants, types, and utilities
└── test/             — Bun unit tests
```

Do not recreate `packages/` or workspace packages. The current platform app template uses one package with `client/` and `server/`.

## Authentication

Use the current Bkper Platform auth patterns.

| Context | Pattern |
| --- | --- |
| Web client | `@bkper/web-auth`; send `Authorization: Bearer <token>` to `/api/*` |
| Server API routes | Use server-side `new Bkper()`; platform outbound auth injects the validated user token |
| Platform event routes | Do not read `bkper-oauth-token`, `bkper-agent-id`, or `Authorization`; event logic is no-op for now |
| Local dev | `bkper auth login`, then `bun run dev`; Vite auth middleware and local outbound use CLI credentials |

## URLs During Migration

- `menuUrl` remains the legacy Apps Script URL for production users.
- `menuUrlDev` points to `https://inventory-bot-preview.bkper.app` for testing the platform client.
- `webhookUrl` remains the legacy Cloud Function URL for production events.
- `webhookUrlDev` points to `https://inventory-bot-preview.bkper.app/events` for testing only.

Do not switch production menu or production events to the platform app unless explicitly requested.

## Events

The declared event subscriptions remain in `bkper.yaml` so preview/dev can be exercised, but `server/src/events/routes.ts` returns `{ result: false }` for all legacy Inventory Bot events.

Do not port or reintroduce the old template demo behavior that created a 20% draft transaction on `TRANSACTION_CHECKED`.

When the real legacy events are migrated later, model the inventory resource movements carefully and protect Bkper's zero-sum invariant: every created or changed transaction must still represent a balanced movement from one account to another.

## Development

```bash
bkper auth login
bun install
bun run dev
```

Local ports are assigned by `/workspace/bkper-apps/AGENTS.md`:

- Vite client: `5175`
- Bkper app Worker: `8787`

## Verification

```bash
bun test
bun run typecheck
bun run build
```

Always run tests and typecheck before considering changes complete. Run `bun run build` after reading the Bkper app management docs because it invokes `bkper app build`.

## Deployment

Do not sync or deploy without explicit confirmation.

```bash
bkper app sync
bkper app deploy --preview
bkper app deploy
```
