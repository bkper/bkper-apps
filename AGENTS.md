# Bkper Apps Monorepo

This repository contains open-source Bkper apps: bots, integrations, and platform apps.

## Apps

| App | Type | Location |
| --- | --- | --- |
| Bkper CSV App | Platform app (Vite + Cloudflare Workers) | `bkper-csv-app/` |
| Exchange Bot | Platform app (Vite + Cloudflare Workers) | `exchange-bot/` |
| Files Preview App | Platform app (Vite + Cloudflare Workers) | `files-preview-app/` |
| Inventory Bot (legacy) | Apps Script + GCP Cloud Functions | `inventory-bot/legacy/` |
| Inventory Bot (new) | Platform app (Vite + Cloudflare Workers) | `inventory-bot/new/` |
| Portfolio Bot | Apps Script + GCP Cloud Functions | `portfolio-bot/` |
| Subledger Bot | GCP Cloud Functions (production; Cloudflare migration) | `subledger-bot/` |
| Tax Bot | GCP Cloud Functions (production; Cloudflare migration) | `tax-bot/` |

## Port Allocation

All local dev servers should use **explicitly assigned ports** to avoid conflicts when running in the same devpod workspace. Do not rely on tool defaults — keep each app's local dev configuration aligned with the tables below.

### Platform apps (Vite client + bkper app dev server)

| App | Vite client | bkper server | Notes |
| --- | --- | --- | --- |
| files-preview-app | `5174` | `8788` | Configured in `vite.config.ts` and `package.json` |
| inventory-bot/new | `5175` | `8796` | Assigned for the new Inventory Bot platform app |
| bkper-csv-app | `5176` | `8789` | Platform replacement for the archived Apps Script CSV app |
| subledger-bot | — | `8790` | Event-only production Worker configured in `package.json` |
| exchange-bot | `5177` | `8793` | Full-stack production app; `8791` and `8792` are used elsewhere in the workspace |
| tax-bot/new | — | `8794` | Event-only migration Worker configured in `package.json` |
| merge-duplicates | `5178` | `8795` | Sidebar app for human-reviewed duplicate transaction merges |

> **Avoid default ports.** Vite's default `5173` is intentionally skipped to prevent conflicts when running multiple projects on the host. Always assign an explicit, non-default port.

**Next available:** Vite client `5179`, bkper server `8797`.

### GCP Cloud Functions bots

| App | functions-framework port | Notes |
| --- | --- | --- |
| portfolio-bot/gcf | `3002` | Configured in `portfolio-bot/gcf/package.json` |
| inventory-bot/legacy/events | `3005` | Configured in `inventory-bot/legacy/events/package.json` |
| tax-bot/legacy | `3041` | Configured in `tax-bot/legacy/package.json` |

**Next available:** `3003`.

### Apps Script components

Apps Script components do not run local dev servers and do not need port assignments:

- `inventory-bot/legacy/menu/`
- `portfolio-bot/gas/`

## Adding a new app

1. Choose the next available port in the appropriate category above.
2. Set the port **explicitly** in the app's config; do not rely on defaults:
   - Platform apps: `server.port` in `vite.config.ts` and `--sp` in `bkper app dev` scripts.
   - GCP bots: `--port` in `functions-framework` scripts.
3. Update the **Port Allocation** table in this file.
4. Update the root `package.json` `ports` script with the new port(s).

## Development

### Forward all ports

From the repository root:

```bash
bun run ports
```

This runs `devpod ssh bkper` with port forwards for every active local dev server in the monorepo.
