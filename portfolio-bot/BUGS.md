# Deferred Bug Fixes

This document tracks known Portfolio Bot bugs that are intentionally preserved during the Cloudflare migration to maintain production parity. Address these fixes after migration stabilization, each with dedicated tests and review.

## 1. Fraction digits are incorrectly used as Book-role metadata

**Status:** Deferred until after migration stabilization.

### Current legacy behavior

Portfolio Bot uses a Book's fraction digits in two role-selection paths:

- `getStockBook()` treats the first Book with zero fraction digits as the Portfolio Book fallback.
- `getFinancialBook()` rejects every Book with zero fraction digits, even when its configured exchange code matches the requested currency.

The migrated implementations preserve these conditions for parity with the legacy GAS and GCF behavior.

### Problem

Fraction digits describe a Book's resource precision, not its role. A legitimate Financial Book for a zero-decimal currency can therefore:

- fail Financial Book resolution despite having the required `exc_code`; and
- be incorrectly selected as the Portfolio Book, depending on Collection order.

This can make supported Account operations unavailable or resolve the wrong Book context.

### Intended fix

Use explicit Book properties as the authoritative role metadata:

- Resolve Financial Books by their configured exchange code without excluding zero-fraction Books.
- Resolve the Portfolio Book by `stock_book` before considering the zero-fraction legacy fallback.
- Retain the zero-fraction Portfolio fallback only for Collections that do not explicitly configure a Portfolio Book.

### Acceptance criteria

- A zero-fraction Financial Book with a matching exchange code is resolved as a Financial Book.
- An explicitly configured Portfolio Book takes precedence over every zero-fraction fallback regardless of Collection order.
- Existing Collections without `stock_book` retain the accepted zero-fraction fallback.
- Base Book and Financial Book Collection-order rules remain deterministic.
- Event and menu Book resolution use the same role-selection rules.
- Deterministic client and server tests cover zero-decimal Financial Books and fallback behavior without accessing live Books.

## 2. Edit-permission errors identify Financial Books only by exchange code

**Status:** Deferred until after migration stabilization.

### Current legacy behavior

Portfolio Bot compares the exchange codes required by the selected Accounts with the exchange codes of Collection Books the user can edit. When a required code is unavailable, the menu reports only that exchange code.

This behavior does not distinguish between:

- a Financial Book that exists but the user cannot edit; and
- a required exchange code with no matching visible Financial Book.

The migrated client preserves this code-only message for parity with the legacy GAS menu.

### Problem

An exchange code does not identify the affected Book as clearly as its name or id. When a Financial Book exists, users need the concrete Book identifier so they can quickly locate it and request the required permission.

Exchange Bot already handles these cases separately: existing targets without edit permission use the Book name, exchange code, or Book id, while configured currencies without a visible connected Book are reported independently by exchange code.

### Intended fix

Separate missing Financial Book resolution from insufficient edit permission:

- For an existing Financial Book without edit permission, identify it by Book name, then exchange code, then Book id.
- For a required exchange code without a matching visible Financial Book, report the exchange code as a distinct resolution error.
- Keep both conditions blocking for Portfolio Bot operations that require the affected Book.

### Acceptance criteria

- Existing Financial Books without edit permission are identified by name, with exchange code and Book id fallbacks.
- Missing visible Financial Books are reported separately by required exchange code.
- Permission and missing-Book errors remain distinct from warnings and operation failures.
- Both conditions prevent mutation requests from starting.
- Server-side authorization remains authoritative regardless of client presentation.
- Deterministic client tests cover existing inaccessible Books, missing Books, and mixed failures without accessing live Books.
