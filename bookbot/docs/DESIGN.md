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
- **History decides when it agrees; Jev ranks when it differs.** Code finds posted history with one search at a time, from the closest scope and most specific description part, and fills the only Account it shows. When it shows several, Jev ranks them by amount, dates, hashtags and properties. Code removes options the draft cannot take and fills only empty sides, so Jev can never suggest an Account this history did not use. This replaced counting the 3 most recent transactions after an end-to-end comparison on a real Book, using only history before each transaction: across 1,210 bank transactions it fixed 25–27 suggestions and broke 2, all in mixed history, and made no difference where history agreed.
- **No suggestion is better than a wrong one.** Jev's first choice fills the draft only at 0.95 confidence or more; below it, discovery stops without a suggestion. On 8,400 bank transactions from 14 real Books, replayed with only earlier history, this cut wrong suggestions by about 60% and kept 93% of right ones; counting the 3 most recent transactions was wrong in about 15% of its suggestions, against about 4% with the threshold, and found fewer right ones. Simpler rules on the searches and more history did not come close. Jev's confidence is not calibrated, so the threshold belongs to Jev's version.

## What tests must cover

- Single and batch equivalence, result correlation, cache isolation and bounded requests.
- Preservation of known Accounts and supplied properties, target-Book Account membership, and no Book writes from API handlers, including failed or cancelled requests.
- The distinction between no-match, no-change and dependency errors, with safe partial-batch results.
- Caller authorization, app identity and AI allowance behavior.
- Rediscovery that never overwrites later user corrections under duplicate deliveries or stale event snapshots.
- The account choice: one option filled without Jev, several ranked by Jev and filled only at 0.95 confidence or more, searches never mixed, options without blocked Accounts, a label that was not offered, and Jev failures.

Tests use doubles and synthetic fixtures. Live Books and paid inference need explicit approval.

## Out of scope

Calibrated confidence, automatic posting and durable background processing, unless a demonstrated need justifies them. `bookbot_confidence_` is Jev's confidence, not a probability calibrated on real Books.
