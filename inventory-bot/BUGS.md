# Deferred Bug Fixes

This document tracks known Inventory Bot bugs that are intentionally preserved during the Cloudflare migration to maintain production parity. Address these fixes after migration stabilization, each with dedicated tests and review.

## 1. Selected non-Asset Accounts bypass the inventory eligibility filter

**Status:** Deferred until after migration stabilization.

### Current legacy behavior

Inventory Bot applies different Account eligibility rules depending on the menu context:

- A selected Account is mapped into the Inventory Book and included in Calculate without checking its Account type.
- A selected Group includes only its `Asset` Accounts.
- Whole-Book Calculate includes only `Asset` Accounts.

The migration preserves this selected-Account exception for parity with the legacy GAS menu. The Account-level API must therefore not introduce an earlier Account-type rejection that would silently change the accepted selected-Account path during migration.

### Problem

Inventory item Accounts are expected to be `Asset` Accounts, but a directly selected non-Asset Account can enter the Calculate workflow. This makes eligibility depend on how the same Account was selected and can pass an unsupported Account into behavior designed for inventory items.

The inconsistent rule can produce confusing no-op, validation, or operation outcomes instead of identifying the selected Account as ineligible before calculation starts.

### Intended fix

After migration stabilization, apply one explicit inventory Account eligibility rule to selected-Account, selected-Group, whole-Book, and direct Account-level API requests:

- Require the Inventory Account to be an `Asset` Account.
- Exclude an ineligible selected Account from the operation scope and present an explicit unsupported-context state.
- Enforce the same rule at the server boundary before any Account or Transaction mutation.
- Keep Financial Book resolution, operation ordering, and accounting behavior unchanged for eligible Accounts.

### Acceptance criteria

- Selected-Account, selected-Group, whole-Book, and direct API contexts use the same `Asset` eligibility rule.
- A selected non-Asset Account produces an explicit unsupported-context response.
- Direct Account-level Calculate and Reset requests reject a non-Asset Inventory Account before any mutation.
- Eligible `Asset` Account selection, alphabetical ordering, and Financial Book resolution remain unchanged.
- Rejected contexts create no Account or Transaction mutation in either the Inventory Book or a Financial Book.
- Deterministic client and server tests cover all context paths without accessing live Books.

## 2. Fraction digits are incorrectly used as menu Book-role metadata

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

## 3. Archived Asset Accounts remain eligible for menu operations

**Status:** Deferred until after migration stabilization.

### Current legacy behavior

The legacy GAS menu selects Accounts by type but does not check archived state:

- selected Account context preserves the existing Account-type exception described above;
- selected Group context includes every returned `Asset` Account; and
- whole-Book context includes every returned `Asset` Account.

The migration preserves this behavior for parity. Unlike Portfolio Bot, Inventory Bot does not exclude an Account solely because `account.isArchived()` is true.

### Problem

Archived Accounts are normally removed from active workflows, but an archived inventory Account can remain in the rendered scope and enter Calculate or Reset. Users may therefore operate on an Account they reasonably expect to be inactive.

Automatically excluding archived Accounts during migration could also hide Inventory state that legacy Reset or Calculate still processes, so this behavior requires a separate correction rather than a silent filter.

### Intended fix

After migration stabilization, define and enforce one explicit archived-Account policy across selected-Account, selected-Group, whole-Book, and direct Account-level API contexts:

- Exclude archived Accounts from normal Calculate and Reset scope unless a separately designed recovery workflow requires them.
- Present an explicit unsupported or archived state when an archived Account is selected directly.
- Enforce the same policy on the server before any Account or Transaction mutation.
- Provide a reviewed recovery path if archived Accounts must remain resettable to restore historical FIFO state.

### Acceptance criteria

- Normal Group and whole-Book operations exclude archived Inventory Accounts.
- A directly selected archived Account receives an explicit, non-mutating outcome.
- Direct Account-level API requests apply the same archived-Account policy as the client.
- Any required archived-Account recovery workflow is explicit and cannot be triggered accidentally.
- Active Account selection, alphabetical ordering, and Financial Book resolution remain unchanged.
- Rejected archived contexts create no Account or Transaction mutation.
- Deterministic client and server tests cover selected, Group, whole-Book, API, and recovery paths without accessing live Books.
