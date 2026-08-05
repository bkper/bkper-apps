# Exchange Bot Cloudflare Target

This directory is the isolated Cloudflare migration target. The production GCP event handler and Apps Script menu under `../legacy/` remain authoritative.

## Current scope

- Event-side parity and drift auditing are complete; preserve the audited event behavior without refactoring or feature changes.
- Keep the client and `/api/v1/*` menu surface minimal until their dedicated roadmap chunks.
- The legacy GCP event handler and Apps Script menu remain production-authoritative.
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
