# Bookbot design

Bookbot finds the From and To Accounts and historical properties for transactions. It serves reusable single and batch discovery to Parser Bot, the Bkper Agent, scripts and other apps, and re-checks pending drafts after a user corrects an Account that Bookbot suggested.

Bookbot started as a copy of the legacy Bookbot Worker, which also read documents. Document reading, attachments, imports and extraction learning now belong to [Parser Bot](../../parser-bot/docs/DESIGN.md); Bookbot keeps only discovery and rediscovery.

Rules, responsibilities, events, properties, the discovery API contract and known current behavior are in [AGENTS.md](../AGENTS.md). Known defects are in [DEFERRED.md](DEFERRED.md).

## Flow

```text
Parser Bot import or created transaction
    -> POST /api/v1/discovery/batch (one batch per target Book)
    -> suggested Account sides and properties, per item
    -> Parser Bot records or updates unposted drafts

Posted or updated transaction with a corrected, Bookbot-suggested Account
    -> Bookbot rediscovers affected pending drafts and updates them

Bkper Agent, scripts and other apps
    -> the same authenticated API, read-only
    -> the caller decides what to write
```

## Design choices

- **Read-only API.** Discovery reads Books and runs inference but never writes. Event handlers or explicitly authorized callers own persistence.
- **One contract for single and batch calls.** A single call behaves like a batch of one item; client item IDs correlate results.
- **Distinct outcomes.** `changed`, `no_change`, `no_match` and `error` stay separate, so a dependency failure never looks like a missing match.
- **Per-Book authorization.** Every target Book needs at least `VIEWER` access for the authenticated principal. API calls do not require installation; event automation does.
- **No posting.** Discovery never posts. Unresolved drafts stay drafts and do not affect balances.

## What tests must cover

- Single and batch equivalence, result correlation, cache isolation and bounded requests.
- Preservation of known Accounts and supplied properties, target-Book Account membership, and no Book writes from API handlers, including failed or cancelled requests.
- The distinction between no-match, no-change and dependency errors, with safe partial-batch results.
- Caller authorization, app identity and AI allowance behavior.
- Rediscovery that never overwrites later user corrections under duplicate deliveries or stale event snapshots.

Tests use doubles and synthetic fixtures. Live Books and paid inference need explicit approval.

## Out of scope

New discovery algorithms, calibrated confidence, automatic posting and durable background processing, unless a demonstrated need justifies them.
