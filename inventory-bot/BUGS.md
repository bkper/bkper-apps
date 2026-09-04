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
