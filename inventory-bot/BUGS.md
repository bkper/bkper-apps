# Deferred Bug Fixes

This document tracks known Inventory Bot bugs that are intentionally preserved during the Cloudflare migration to maintain production parity. Address these fixes after migration stabilization, each with dedicated tests and review.

## 1. Fraction digits are incorrectly used as menu Book-role metadata

**Status:** Deferred until after migration stabilization.

### Current legacy behavior

The legacy GAS menu uses a Book's fraction digits in two role-selection paths:

- `getInventoryBook()` scans the Collection once and returns the first Book that either has `inventory_book` or has zero fraction digits. An earlier zero-fraction Book therefore beats a later explicitly configured Inventory Book.
- `getFinancialBook()` rejects every Book with zero fraction digits, even when its configured exchange code matches the Inventory Account's exchange code.

The event implementation does not use these fraction-digit rules: it resolves the Inventory Book through `inventory_book` and Financial Books through their exchange codes. The menu migration preserves the GAS conditions for parity rather than silently standardizing the two production surfaces.

### Problem

Fraction digits describe a Book's resource precision, not its role. Collection order and numeric precision can therefore cause the menu to:

- resolve a zero-fraction Book instead of the explicitly configured Inventory Book;
- reject a legitimate zero-decimal Financial Book; and
- resolve a different Book scope from the event implementation.

This can make valid operations unavailable or direct the menu context at the wrong Book.

### Intended fix

Use explicit Book properties as authoritative role metadata after migration stabilization:

- Resolve the Inventory Book by `inventory_book` before considering the zero-fraction legacy fallback.
- Resolve Financial Books by their configured exchange code without excluding zero-fraction Books.
- Retain the zero-fraction Inventory Book fallback only for Collections without an explicitly configured Inventory Book, if production evidence still establishes a compatibility need.
- Standardize menu and event Book-role resolution in a separately reviewed change.

### Acceptance criteria

- An explicitly configured Inventory Book takes precedence over every zero-fraction fallback regardless of Collection order.
- A zero-fraction Financial Book with the matching exchange code is resolved as a Financial Book.
- Existing Collections without `inventory_book` retain the accepted fallback until its compatibility requirement is reviewed.
- Collection-order rules remain deterministic when multiple Books match the same role.
- Menu and event Book resolution use the same documented role-selection rules.
- Failed Book resolution performs no Account or Transaction mutation.
- Deterministic client and server tests cover explicit selection, zero-fraction fallback, zero-decimal Financial Books, and Collection order without accessing live Books.

## 2. Archived permanent Accounts remain eligible for operations

**Status:** Deferred until after migration stabilization.

### Current behavior

The migrated client and Account-level server API require a permanent Account with an exchange code, but do not reject an Account solely because `account.isArchived()` is true.

### Problem

Archived Accounts are normally removed from active workflows, but an archived Inventory Account can remain in the rendered scope and enter Calculate or Reset.

### Intended fix

After migration stabilization, define and enforce an explicit archived-Account policy at the client and server boundaries before any Account or Transaction mutation. Provide a reviewed recovery path if archived Accounts must remain resettable to restore historical FIFO state.

### Acceptance criteria

- Normal client scopes and direct Account-level API requests apply the same archived-Account policy.
- Any required archived-Account recovery workflow is explicit and cannot be triggered accidentally.
- Active Account selection, alphabetical ordering, and Financial Book resolution remain unchanged.
- Rejected archived contexts create no Account or Transaction mutation.
- Deterministic client and server tests cover operation and recovery paths without accessing live Books.

## 3. Inventory deletion events can skip linked Financial COGS cleanup

**Status:** Deferred until after migration stabilization.

### Current legacy behavior

The legacy Inventory Book deletion classifier reads Account types directly from the deleted Transaction's `creditAccount` and `debitAccount` references. The Cloudflare target preserves this behavior for migration parity, and the corresponding deployed legacy artifact matched the preserved source during the baseline audit.

Isolated preview validation showed that a live `TRANSACTION_DELETED` payload did not retain the original typed endpoint shape at those references. The Transaction carried id-only Account references in a shape that did not satisfy the legacy classifier, while the original endpoint ids were available in `previousAttributes` and complete Account snapshots were available separately in the operation payload.

The target consequently returned the inherited no-op result when an Inventory movement with a linked checked Financial COGS Transaction was deleted. Canonical re-reads confirmed that the Inventory movement was trashed while the linked COGS Transaction remained active. The isolated fixture was manually reconciled after the result was established.

This preview result proves the behavior in the migrated runtime. Production routing was not changed and the scenario was not replayed through the production GCP handler, so the production runtime outcome was not directly exercised.

### Problem

A deleted Inventory movement can fail classification before linked cleanup begins. When that happens, its linked Financial COGS Transaction can remain active without the Inventory movement that owns the relationship.

Each surviving Transaction remains a complete zero-sum movement within its own Book, but the cross-Book lifecycle relationship becomes orphaned and COGS can remain overstated.

### Intended fix

After migration stabilization, normalize deleted Transaction endpoints at the event boundary before invoking lifecycle classification:

- reconstruct the original endpoint ids from `previousAttributes` when deletion payloads no longer retain the original movement shape;
- resolve Account types and names from the operation's Account snapshots or canonical Account reads;
- keep payload adaptation separate from deletion business rules;
- preserve explicitly accepted classifier no-ops unless a separate behavior change is reviewed; and
- reconcile authoritative Book state before retrying cleanup when a prior deletion outcome is uncertain.

### Acceptance criteria

- A classified Inventory deletion resolves the original item Account from the live deletion payload shape.
- Linked checked Financial COGS is unchecked and trashed in the established order.
- Missing Accounts, missing links, and unsupported deletion shapes remain non-mutating.
- Generated purchase and sale classifier behavior changes only when explicitly reviewed rather than as a side effect of payload normalization.
- No replacement or incomplete movement is created.
- Canonical post-operation reads confirm unique relationships and no orphaned active COGS.
- Deterministic tests use a fixture matching the observed live payload structure, including `previousAttributes` and separate Account snapshots.
- Every participating Book remains independently zero-sum.
