# Tax Bot

This directory is the production Cloudflare Worker for the published `sales-tax-bot` app. Follow [`ROADMAP.md`](./ROADMAP.md) for migration history, parity evidence, rollback records, and deferred GCP retirement. Track accepted post-migration issues in [`BUGS.md`](./BUGS.md).

The unchanged GCP deployment remains available only as a routing rollback target. Its source was removed from the active working tree after cutover and remains recoverable from Git history. Do not delete or modify the retained deployment without separate explicit approval.

## Scope

- Keep the app server-only: `/events` only. Do not add a standalone health endpoint.
- Do not add a client, public `/api/*`, OpenAPI, static assets, KV, or secrets.
- Preserve accepted legacy tax behavior unless a separately approved change explicitly replaces it.
- Protect Bkper's zero-sum invariant. Every posted tax Transaction must remain one complete movement with one amount, one origin Account, and one destination Account. Unresolved movements must remain drafts.
- Never mutate a source Transaction. Create or trash only its linked tax Transactions.

## Authentication

Create request-scoped `Bkper` instances without token providers. Platform outbound authentication supplies the event user's OAuth context and app agent identity. Never read or forward `Authorization`, `bkper-oauth-token`, or `bkper-agent-id` in Worker code.

## Development

```bash
bun install
bun run dev
```

The local Worker uses port `8794`.

## Verification

```bash
bun run check
```

Tests must be deterministic and must not use credentials, network access, or live Books.

## Rollback and remote operations

Production and developer routing are defined in `bkper.yaml`. Restoring the GCP webhook, syncing app metadata, deploying, installing, replaying events, running canaries, or writing to any Book requires explicit approval immediately before the operation. Building and testing locally do not authorize any remote mutation.
