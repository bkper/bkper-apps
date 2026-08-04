# Subledger Bot

This directory is the production Cloudflare Worker for the published `subledger-bot` app. Follow [`ROADMAP.md`](./ROADMAP.md) for migration history, parity evidence, rollback records, and deferred GCP retirement.

The unchanged GCP function `prodGen2` remains deployed only as a routing rollback target. Its source was removed from the active working tree after cutover and remains recoverable from Git tree `31ffa7c77268a31f551ea5212792cc53056aa7eb`. Do not delete or modify the GCP deployment without separate explicit approval.

## Scope

- Keep the app server-only: `/health` and `/events` only.
- Do not add a client, public `/api/*`, OpenAPI, static assets, KV, or secrets.
- Preserve accepted legacy business behavior unless a separately approved change explicitly replaces it.
- Protect Bkper's zero-sum invariant. A consolidated transaction must remain one complete movement with one amount, and unresolved movements must remain drafts.

## Authentication

Create request-scoped `Bkper` instances without token providers. Platform outbound authentication supplies the event user's OAuth context and app agent identity. Never read or forward `Authorization`, `bkper-oauth-token`, or `bkper-agent-id` in Worker code.

## Development

```bash
bun install
bun run dev
```

The local Worker uses port `8790`.

## Verification

```bash
bun run check
```

Tests must be deterministic and must not use credentials, network access, or live Books.

## Rollback and remote operations

Production and developer routing are defined in `bkper.yaml`. Restoring the GCP webhook, syncing app metadata, deploying, installing, replaying events, or writing to any Book requires explicit approval immediately before the operation. Building and testing locally do not authorize any remote mutation.
