# Exchange Bot Cloudflare Target

This directory is the isolated Cloudflare migration target. The production GCP event handler and Apps Script menu under `../legacy/` remain authoritative.

## Current scope

- Keep this as a minimal full-stack shell: static client assets, `/health`, `/events`, `/api/v1/*`, and `/openapi.json`.
- `/events` must remain non-mutating until event parity is ported in later roadmap chunks.
- Do not add menu business operations before their dedicated roadmap chunks.
- Protect Bkper's zero-sum invariant; tests must never write to live Books.

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

Do not sync, deploy, configure secrets, install the app, replay events, change routing, or write to Books without separate explicit approval.
