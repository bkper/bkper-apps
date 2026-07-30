# Subledger Bot Cloudflare Migration

This is the event-only Cloudflare Worker migration target. The production-authoritative GCP implementation remains in `../legacy/` until the separately approved production webhook cutover.

## Scope

- Keep the app server-only: `/health` and `/events` only.
- Do not add a client, public `/api/*`, OpenAPI, static assets, KV, or secrets.
- Preserve legacy business behavior during parity work; do not combine migration with fixes or redesigns.
- Protect Bkper's zero-sum invariant. A consolidated transaction must remain one complete movement with one amount, and unresolved movements must remain drafts.

Follow the mandatory [mechanical parity port rules](../ROADMAP.md#mechanical-parity-port-rules) before changing migration code.

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

## Remote operations

Do not run app sync, deploy, install, or any Book write without explicit approval immediately before the operation. Building locally does not authorize deployment or routing changes.
