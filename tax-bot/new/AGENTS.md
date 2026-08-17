# Tax Bot Cloudflare Migration

This is the event-only Cloudflare Worker migration target. Subscribed event behavior has been ported, the full deterministic parity and drift audit is complete, and preview deployment, developer routing, and the first included-tax canary have passed. Broader deterministic preview validation remains. The active GCP implementation remains in `../legacy/` until the separately approved production webhook cutover.

## Scope

- Keep the app server-only: `/events` only. Do not add a standalone health endpoint.
- Do not add a client, public `/api/*`, OpenAPI, static assets, KV, or secrets.
- Preserve legacy tax behavior during parity work; do not combine migration with fixes or redesigns.
- Protect Bkper's zero-sum invariant. Every posted tax Transaction must remain one complete movement with one amount, one origin Account, and one destination Account. Unresolved movements must remain drafts.

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

## Remote operations

Do not run app sync, deploy, install, or any Book write without explicit approval immediately before the operation. Building locally does not authorize deployment or routing changes.
