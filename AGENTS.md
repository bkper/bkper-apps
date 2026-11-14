# Bkper Apps Monorepo

This repository contains open-source Bkper apps: bots, integrations, and platform apps.

## Apps

| App | Type | Location |
| --- | --- | --- |
| Bkper CSV App | Platform app (Vite + Cloudflare Workers) | `bkper-csv-app/` |
| Bkper for Slack | Metadata-only App and Slack manifests (behavior in bkper-clients `packages/channels`) | `bkper-slack/` |
| Exchange Bot | Platform app (Vite + Cloudflare Workers) | `exchange-bot/` |
| Files Preview App | Platform app (Vite + Cloudflare Workers) | `files-preview-app/` |
| Inventory Bot | Platform app (Vite + Cloudflare Workers) | `inventory-bot/` |
| Subledger Bot | GCP Cloud Functions (production; Cloudflare migration) | `subledger-bot/` |
| Tax Bot | Platform app (Cloudflare Workers) | `tax-bot/` |
| Bookbot | Platform app (Cloudflare Workers); completes drafts: amount and date from the description, accounts from history; completion API, typed drafts and rediscovery; never sync from the legacy repository | `bookbot/` |
| Extractor Bot | Platform app (Cloudflare Workers); reads documents into drafts, asks Bookbot to complete them, and learns from corrections; app ID `extractor-bot` | `extractor-bot/` |
| Extractor Bot (retiring ID `parser-bot`) | Registration-only shell for the live `parser-bot` app (code frozen at tag `parser-bot-final`); sync only, never deploy | `parser-bot/` |
| Report | Platform app (Vite + Cloudflare Workers); read-only financial reports from a typed request | `report/` |

## Plans

- Plans are ephemeral: delete a plan as soon as its work is done.
- Never reference plans from code, comments, tests, configs, skills, or `AGENTS.md` files: no paths, and no plan phase, step, section, or decision numbers. Write the rule or the reason itself where it applies.

## Environments

Build as an external developer: preview (`menuUrlDev`, `webhookUrlDev`) and production both run on Bkper in production and its API. Never infer a Bkper origin from the app's own address; use the origin of the embedding Book's messages, or `https://bkper.app`.

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
| report | `5207` | `8809` |

### Bookbot and Extractor Bot

| App | Worker | Inspector |
| --- | --- | --- |
| bookbot | `8807` | `9607` |
| extractor-bot | `8808` | `9608` |

These ports are for local development, not live event delivery. Both directories started from the same legacy Bookbot code. Both apps are live on the Platform; sync Bookbot only from this repository. Read each app's `AGENTS.md` before work; do not deploy, sync, install, or publish either app without separate approval.

**Next available:** client `5208`, Worker `8810`.

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
