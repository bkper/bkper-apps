# Bookbot design

Bookbot finds the From and To Accounts and historical properties for transactions. It serves reusable single and batch discovery to apps, agents and scripts, and re-checks pending drafts after a user corrects an Account that Bookbot suggested.

Rules, responsibilities, events, properties, the discovery API contract and known current behavior are in [AGENTS.md](../AGENTS.md). Known defects are in [DEFERRED.md](DEFERRED.md).

## Flow

```text
Apps, agents and scripts
    -> POST /api/v1/discovery or /api/v1/discovery/batch (one batch per target Book), read-only
    -> suggested Account sides and properties, per item
    -> the caller decides what to write, such as unposted drafts

Posted or updated transaction with a corrected, Bookbot-suggested Account
    -> Bookbot rediscovers affected pending drafts and updates them
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
