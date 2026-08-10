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

Duplicate Book instances cause repeated context validation and duplicate UI context entries. Duplicate eligible entries can also submit concurrent Exchange Update requests for the same target Book. In addition, the exchange-update service can process the same connected Book multiple times using the same preloaded balances report. Each path can create duplicate exchange-adjustment movements.

### Intended fix

Deduplicate connected Books by `book.getId()` while preserving first-discovery order across legacy properties and Collection membership. Apply the same rule consistently to the client and server API implementations.

### Acceptance criteria

- A Book configured through multiple deprecated properties is returned once.
- A Book configured through both deprecated properties and Collection membership is returned once.
- First-discovery order remains deterministic.
- Context validation runs once per Book id.
- The client submits each eligible target Book id once per Exchange Update run.
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

## 7. Client conflates blocking errors with non-blocking warnings

**Status:** Deferred until after migration stabilization.

### Current legacy behavior

The GAS client uses the same error-oriented state and presentation for conditions with different effects on Exchange Update:

- Missing EDITOR or OWNER permission on the selected Book is blocking. The view returns early and omits the Exchange Update action.
- Missing permission on configured connected Books, pending bot tasks, and bot event errors set `permissionGranted` to false and populate `permissionError`, but the action remains available because its visibility depends only on `basePermissionGranted`.
- Rate-loading, per-Book update, audit, retry, and window-closing failures also share the same error panel even though they occur at different workflow stages and do not all have the same operational effect.

### Problem

State names and presentation imply that all reported conditions are errors and therefore blocking, while some only display a message and allow Exchange Update to proceed. Users cannot reliably distinguish an advisory warning from a condition that prevents or terminates an operation. The shared model also makes it easy for the migrated client to accidentally disable a valid action or allow an action that should be blocked.

### Intended fix

After migration stabilization, define explicit client states for blocking validation errors, non-blocking warnings, and operation failures. Classify each existing condition deliberately and make action availability follow that classification rather than the panel or property used to display its message.

### Acceptance criteria

- Every initialization validation and operation failure has an explicit severity and blocking effect.
- Missing edit permission on the selected Book remains blocking.
- The intended behavior of missing connected-Book permission, pending tasks, and bot event errors is decided explicitly before changing their current behavior.
- Blocking conditions prevent Exchange Update requests from starting.
- Non-blocking warnings remain visible without being presented as blocking errors.
- Rate-loading, per-Book update, retry, and audit failures use states appropriate to their workflow stage.
- Message presentation is separate from action-availability logic.
- Deterministic client tests cover presentation, action availability, and request boundaries for each classification without accessing live Books.

## 8. Exchange Update retries rerun every eligible Book

**Status:** Deferred until after migration stabilization.

### Current legacy behavior

The menu starts one Exchange Update request for every eligible Book. When any request fails, one shared retry handler calls the complete Exchange Update operation again. This resubmits every eligible Book rather than retrying only the Book whose request failed.

The retry handler also uses one shared retry count and one shared error panel. Parallel failures therefore share retry state and can overwrite each other's messages while other Book updates remain in progress or have already succeeded.

### Problem

A failure in one Book can cause successful or in-flight Books to be submitted again. Because each submission can create exchange-adjustment movements, resubmitting unrelated Books introduces a duplicate-movement risk. Shared retry and error state also prevents the UI from clearly identifying independent failures across multiple Books.

### Intended fix

Track each eligible Book as an independent Exchange Update operation. Retry only the failed Book, keep successful and in-flight Books untouched, and show progress, retry attempts, results, and final errors separately for each Book.

This intentionally changes both request orchestration and UI behavior, so it must not be combined with the parity migration.

### Acceptance criteria

- The initial run still starts one Exchange Update request for each eligible Book.
- A failed request retries only its own Book id.
- Successful and in-flight Book operations are never resubmitted by another Book's failure.
- Parallel failures maintain independent retry counts and messages.
- The UI identifies the Book associated with every waiting, retrying, successful, and failed state.
- Retrying one Book cannot clear or overwrite another Book's result or error.
- Deterministic client tests cover mixed success, one failure, and multiple parallel failures without accessing live Books.
- Tests prove that each accepted update still produces only complete movements with one origin Account, one destination Account, and one amount.

## 9. Post-mutation summary failures are reported as operation failures

**Status:** Deferred until after migration stabilization.

### Current legacy behavior

The GAS `updateGainLoss` operation creates transactions and then builds its summary within the same server call. If summary construction fails after transaction creation, the client receives a failure and enters its retry flow even though some or all mutations may already have succeeded.

The migration target preserves one broad failure boundary around the Exchange Update POST and client-side summary construction. A summary or formatting error after a successful POST is therefore presented as an Exchange Update failure.

### Problem

Once a mutation has been accepted, reporting it as failed can encourage the user or retry flow to submit it again. Repeating an Exchange Update from the same pre-update context can create duplicate adjustment movements. Presentation failures must not obscure a known successful mutation outcome.

### Intended fix

Track mutation outcome separately from summary and presentation outcome. Once the API confirms a successful Exchange Update, retain a successful operation state even if its summary cannot be produced. Report summary failures as non-mutating warnings without offering mutation retry as the remedy.

### Acceptance criteria

- A failed POST remains an Exchange Update failure.
- A successful POST remains successful even when summary construction or formatting fails.
- Summary failures display a clear non-mutating warning.
- Summary failures never automatically retry or recommend rerunning the accepted mutation.
- Per-Book mutation and summary outcomes remain independent.
- Deterministic client tests cover successful summaries, failed POSTs, and post-success summary failures without accessing live Books.

## 10. Edited rates retain results from the previous Exchange Update

**Status:** Deferred until after migration stabilization.

### Current legacy behavior

Successfully loading rates for another date rebuilds the GAS rates panel and clears previous results. The migration target also clears results after the latest rate-loading request succeeds. However, manually editing a displayed exchange rate does not clear a previous Exchange Update result in either implementation.

### Problem

A completed result can remain visible beside a rate value that has changed since that result was produced. This can make an edited, unprocessed rate appear to have already completed successfully.

### Intended fix

Invalidate prior results whenever a user edits an exchange rate, without triggering a mutation or silently reverting the edited value.

### Acceptance criteria

- A successful rate reload clears results from the previous date.
- Editing any rate clears or explicitly marks previous results as stale.
- Rate edits remain local until the user starts Exchange Update.
- Clearing stale presentation state performs no API mutation.
- Deterministic client tests cover successful date reloads and manual rate edits without accessing live Books.
