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

## 4. Editable exchange rates accept non-numeric text

**Status:** Deferred until after migration stabilization.

### Current legacy behavior

Exchange-rate fields are regular text inputs. Their values are copied directly into the mutable rates object without client-side validation, so arbitrary non-numeric strings are accepted as edited rates.

### Problem

The client can hold an invalid exchange-rate payload without telling the user which value is invalid. The migration API rejects non-numeric rates at its server-side schema boundary, but relying only on submission-time rejection produces poor feedback and leaves the update form in an invalid state.

### Intended fix

Validate edited rates in the client without silently sanitizing or changing user input. Keep server-side schema validation as the final safety boundary.

### Acceptance criteria

- Non-numeric rates are identified before an exchange update is submitted.
- Each invalid rate receives a clear inline validation message.
- Exchange update cannot run while any edited rate is invalid.
- The accepted rules for zero and negative rates are decided explicitly and covered by tests.
- Server-side validation continues to reject invalid rate payloads.
- Deterministic client tests cover valid, invalid, and corrected values.

## 5. Connected Books are not deduplicated by Book id

**Status:** Deferred until after migration stabilization.

### Current legacy behavior

Connected Books are accumulated in a `Set<Book>`. JavaScript Sets compare objects by identity, so separate `Book` instances with the same id are not deduplicated. The same Book can therefore appear more than once when configured through multiple sources, including:

- one or more deprecated `exc_*_book` properties;
- the deprecated `exc_books` property; and
- Collection membership with an exchange code.

The client and server API implementations both preserve this behavior.

### Problem

Duplicate Book instances cause repeated context validation and duplicate UI context entries. More importantly, the exchange-update service can process the same connected Book multiple times using the same preloaded balances report, potentially creating duplicate exchange-adjustment movements.

### Intended fix

Deduplicate connected Books by `book.getId()` while preserving first-discovery order across legacy properties and Collection membership. Apply the same rule consistently to the client and server API implementations.

### Acceptance criteria

- A Book configured through multiple deprecated properties is returned once.
- A Book configured through both deprecated properties and Collection membership is returned once.
- First-discovery order remains deterministic.
- Context validation runs once per Book id.
- Exchange update processes each connected Book id once.
- Deterministic client and server tests cover duplicate configuration sources without accessing live Books.

## 6. Selected-Book edit permission is checked after pending tasks

**Status:** Deferred optimization until after migration stabilization.

### Current legacy behavior

The menu loads connected Books and checks their backlogs before checking whether the user can edit the selected Book. The migration target preserves this request order for parity. If the user lacks EDITOR or OWNER permission, the pending-task results are discarded by the subsequent early return.

### Problem

Users who cannot edit the selected Book wait for unnecessary backlog requests across the connected context. A backlog request failure can also surface a general loading error before the menu reaches the more relevant selected-Book permission message.

### Intended optimization

Check the selected Book's edit permission before loading connected-Book context or running pending-task and event-error validations. If permission is insufficient, return immediately with the existing permission message. Treat the changed request and error ordering as an intentional post-migration behavior improvement rather than migration parity.

### Acceptance criteria

- EDITOR and OWNER users continue through the complete context validation flow.
- Other permission levels receive the existing selected-Book permission message without connected-Book, backlog, configured-code, or event-error requests.
- Missing-permission, pending-task, and event-error warning precedence remains unchanged for users who can edit the selected Book.
- Deterministic client tests verify the early return and request boundaries without accessing live Books.
