# Deferred Bug Fixes

This document tracks known Exchange Bot bugs that are intentionally preserved during the Cloudflare migration to maintain production parity. Address these fixes as soon as the migration is stabilized, each with dedicated tests and review.

## 1. Event-error validation excludes connected Books outside the Collection

**Status:** Deferred until after migration stabilization.

### Current legacy behavior

The menu checks event errors only in Books returned by the selected Book's Collection. It does not check:

- Books connected through legacy Book properties but outside the Collection; or
- the selected Book when it does not belong to a Collection.

### Problem

Exchange Bot can operate on the selected Book and Books connected through both Collection membership and legacy properties. Errors in part of that connected context can therefore go unreported by the menu validation.

### Intended fix

Check event errors across the selected Book and every connected Book, including legacy-property connections outside the Collection.

### Acceptance criteria

- Collection Books with event errors remain reported.
- Connected Books outside the Collection are also reported.
- A selected Book outside a Collection is checked.
- Missing-permission and pending-task warnings retain their existing precedence over event-error warnings.
- Deterministic client tests cover each validation scope without accessing live Books.

## 2. Pending-task validation skipped Books without an exchange code

**Status:** Fixed during migration review.

The migration target initially checked a Book's exchange code before checking its backlog. This skipped pending-task validation for an unconfigured selected Book or a Book connected through deprecated properties without an exchange code.

The target now preserves the legacy check across the selected Book and every connected Book regardless of exchange-code configuration.

## 3. Validation warnings cannot identify Books without an exchange code

**Status:** Deferred until after migration stabilization.

### Current legacy behavior

Pending-task validation can surface Books that have no exchange code, but its warning contains a blank Book identifier. If event-error validation is expanded as described in bug 1, event-error warnings can encounter the same problem.

### Problem

The validation can correctly block the workflow while displaying a message such as `There are pending bot tasks in  book`, which does not tell the user which Book requires attention.

### Intended fix

Keep validation scopes independent from exchange-code configuration. When an exchange code is unavailable, identify the affected Book with a meaningful fallback such as its name or id.

### Acceptance criteria

- Exchange codes remain the preferred identifiers.
- Affected Books without exchange codes receive a meaningful fallback identifier.
- The fallback applies consistently to pending-task and event-error warnings.
- Collection and deprecated-property connections remain supported.
- Existing warning precedence remains unchanged.
- Deterministic client tests cover each fallback without accessing live Books.
