# Bkper Apps Monorepo

This repository contains open-source Bkper apps: bots, integrations, and platform apps.

## Apps

| App | Type | Location |
| --- | --- | --- |
| Bkper CSV App | Platform app (Vite + Cloudflare Workers) | `bkper-csv-app/` |
| Exchange Bot | Platform app (Vite + Cloudflare Workers) | `exchange-bot/` |
| Files Preview App | Platform app (Vite + Cloudflare Workers) | `files-preview-app/` |
| Inventory Bot | Platform app (Vite + Cloudflare Workers) | `inventory-bot/` |
| Subledger Bot | GCP Cloud Functions (production; Cloudflare migration) | `subledger-bot/` |
| Tax Bot | Platform app (Cloudflare Workers) | `tax-bot/` |

## Port Allocation

Local ports: clients `5200–5249`, Workers `8800–8849`, inspectors `9600–9649`. Assign distinct ports per app; keep launch commands, proxies and HMR aligned with `strictPort: true`.

### Platform apps (Vite client + bkper app dev server)

| App | Vite client | bkper server |
| --- | --- | --- |
| files-preview-app | `5200` | `8800` |
| bkper-csv-app | `5201` | `8801` |
| inventory-bot | `5202` | `8802` |
| subledger-bot | — | `8803` |
| exchange-bot | `5204` | `8804` |
| tax-bot | — | `8805` |
| merge-duplicates | `5206` | `8806` |

**Next available:** client `5207`, Worker `8807`.

### GCP Cloud Functions bots

No active local GCP bot projects remain. Inventory Bot's deployed GCP runtime is retained for rollback, but its legacy source and local tooling are recoverable from Git history rather than the working tree. Port `3005` is no longer forwarded.

**Next available:** `3002`.

### Apps Script components

No active local Apps Script components remain. Inventory Bot's deployed GAS menu is retained for rollback; its source and local tooling are recoverable from Git history.

## Adding a new app

1. Choose an unused port in this repository's range.
2. Set the port **explicitly** in the app's config; do not rely on defaults:
   - Platform apps: `server.port` in `vite.config.ts` and `--sp` in `bkper app dev` scripts.
   - GCP bots: `--port` in `functions-framework` scripts.
3. Update the **Port Allocation** table in this file and current app development docs.
4. Update the root `package.json` `ports` script with the new port(s).

## Development

### Forward all ports

From the repository root:

```bash
bun run ports
```

This runs `devpod ssh bkper` with port forwards for every active local dev server in the monorepo.
