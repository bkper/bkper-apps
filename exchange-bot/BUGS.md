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

## 2. Validation warnings cannot identify Books without an exchange code

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

## 3. Editable exchange rates accept non-numeric text

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

## 4. Connected Books are not deduplicated by Book id

**Status:** Fixed in the client; server API deduplication remains deferred until after migration stabilization.

### Current migration behavior

The client deduplicates connected Books by `book.getId()`, reuses eligible embedded Collection Books, and preserves legacy-first discovery order. Duplicate deprecated ids are loaded once, and each connected Book id is returned once.

The server API still accumulates connected Books in a `Set<Book>`. Because JavaScript Sets compare objects by identity, separate server-side `Book` instances with the same id can remain duplicated when configured through deprecated properties and Collection membership.

### Remaining problem

The client-side duplicate validation, UI entry, and duplicate target-request risks are fixed. The server exchange-update service can still process the same connected Book more than once using the same preloaded balances report, which can create duplicate exchange-adjustment movements.

### Intended fix

Retain the client rule and apply the same Book-id deduplication to the server API while preserving first-discovery order.

### Acceptance criteria

- A Book configured through multiple deprecated properties is returned once.
- A Book configured through both deprecated properties and Collection membership is returned once.
- First-discovery order remains deterministic.
- Context validation runs once per Book id.
- The client submits each eligible target Book id once per Exchange Update run.
- Exchange update processes each connected Book id once.
- Deterministic client and server tests cover duplicate configuration sources without accessing live Books.

## 5. Client conflates blocking errors with non-blocking warnings

**Status:** Partially resolved; remaining operation-stage classifications are deferred until after migration stabilization.

### Current legacy behavior

The GAS client uses the same error-oriented state and presentation for conditions with different effects on Exchange Update:

- Missing EDITOR or OWNER permission on the selected Book is blocking. The view returns early and omits the Exchange Update action.
- Missing permission on configured connected Books, pending bot tasks, and bot event errors populate their warning or error message, but the action remains available because its availability depends only on `hasEditorPermission`.
- Rate-loading, per-Book update, audit, retry, and window-closing failures also share the same error panel even though they occur at different workflow stages and do not all have the same operational effect.

### Problem

State names and presentation imply that all reported conditions are errors and therefore blocking, while some only display a message and allow Exchange Update to proceed. Users cannot reliably distinguish an advisory warning from a condition that prevents or terminates an operation. The shared model also makes it easy for the migrated client to accidentally disable a valid action or allow an action that should be blocked.

### Migration target follow-up

The target now treats missing connected Books, pending bot tasks, and bot errors as independent non-blocking context warnings. All simultaneous warnings are displayed in deterministic order, while blocking Book authorization remains in the permission-error state. Background validation failures have a separate retryable state that preserves completed warnings and does not disable Exchange Update. Operation-stage failures still require the broader classification described below.

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

## 6. Post-mutation summary failures are reported as operation failures

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

## 7. Edited rates retain results from the previous Exchange Update

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

## 8. Connected-Book discovery and chart loading perform redundant sequential requests

**Status:** Client startup optimization complete; server Exchange Update chart-loading optimization remains deferred. The separate SDK cache-amplification issue is fixed by the server's `bkper-js` 2.42.0 compatibility migration.

### Current client behavior

The selected Book loads once with its complete Account chart because startup always reads its configured currency Groups. Eligible Collection Books reuse their embedded payloads. Deprecated connection ids are deduplicated, Collection matches reuse the embedded Book, and only unique legacy-only Books generate lean requests. Those requests run in ordered batches of five, and connected Books remain deduplicated by id in legacy-first order.

After connected-Book discovery and permission checks, the client enters `READY`; Exchange Update renders and rate loading can begin. Missing-currency, pending-task, and event-error validations then run as sequential categories. Per-Book backlog and event requests use ordered batches of five. Progress and completed warnings remain visible, and a validation failure can be retried from a clean validation state without reloading Books.

A failure during blocking connected-Book discovery still occurs before `READY` and remains outside the validation retry boundary.

### Remaining server behavior

Exchange Update loads the target Book with its complete chart once. For each connected Book, it first checks the target chart for matching Accounts. Only when matches exist does it load that connected Book with its complete chart before calculating and creating movements.

Server `bkper-js` 2.42.0 resolves embedded Account Group ids and cached Groups with no Accounts through the complete Book chart. This fixes the 2.19.0 cache amplification that issued per-Account or empty-Group requests. A matching Book discovered through a deprecated property can still require both a lean discovery request and a later complete-chart request. The service continues to avoid loading a connected chart when no target Accounts match.

### Remaining optimization

Evolve the server menu API `BotService.getConnectedBooks` boundary to support caller-selected Book completeness, including an opt-in complete-chart mode. Resolve independent Book loads through bounded concurrency while preserving deterministic result and mutation order. Allow Exchange Update to hydrate only connected Books whose currency codes have matching target Accounts, avoiding both redundant lean/full requests and unnecessary chart loads.

Keep rate loading on lean Book metadata. Do not change transaction construction, batch order, audit behavior, or movement direction and amount.

### Acceptance criteria

- Server callers explicitly choose whether connected Books require lean metadata or complete Accounts and Groups.
- Exchange-rate loading does not fetch complete charts.
- Exchange Update does not fetch a connected chart when no target Accounts match its currency code.
- A matching deprecated-property Book is not loaded once lean and again with its complete chart.
- Independent read-only Book loads use explicit bounded concurrency and deterministic result order.
- Connected-Book transaction batches retain their established mutation order.
- Deterministic tests assert request count, requested Book completeness, skipped charts, result order, and mutation order without accessing live Books.
- Representative runtime measurements confirm the optimization without relying on timing assertions in unit tests.

## 9. Exchange Update retries lack delay and structured error classification

**Status:** Deferred retry-policy improvement.

### Current migration behavior

A failed Exchange Update retries only its own Book up to five times. Retries start immediately for every error except one whose message contains the established `not found in` text. The client API currently exposes plain error messages rather than the structured HTTP status and response metadata needed for a more selective policy.

### Problem

Immediate retries can repeat temporary rate-limit or infrastructure failures without giving the dependency time to recover. Message-only classification also cannot reliably distinguish retryable transport failures from permanent business failures or honor a server-provided `Retry-After` value.

### Intended improvement

Preserve independent per-Book retry state while introducing structured error classification. Retry only explicitly accepted transient failures and apply a bounded delay policy, preferring valid server-provided retry timing and otherwise using an explicitly chosen backoff schedule.

### Acceptance criteria

- Successful and in-flight Books remain untouched when another Book retries.
- Retryable and non-retryable failures are classified from structured error data rather than message text where the API boundary provides it.
- A valid `Retry-After` value is honored within an explicit maximum delay.
- Transient failures without server timing use a documented bounded delay schedule.
- Permanent failures stop immediately with the final per-Book error.
- Per-Book retry progress remains visible during each delay and request.
- Deterministic client tests cover classification, retry limits, and delay selection without live API access or wall-clock timing.

## 10. Client-triggered post-update Book audits may be unnecessary

**Status:** Preserved conditionally for migration validation; removal review deferred until after stabilization.

### Current migration behavior

Exchange Update POST updates one path Book and returns its accepted Account and Transaction resources. Auditing is not part of that reusable API contract.

After each successful target response, the menu client inspects `createdTransactions`. When at least one transaction was accepted, it triggers one fire-and-forget `Book.audit()` on that target Book. Failed POST attempts, no-op responses, and Account-only responses do not trigger an audit. The audit does not participate in mutation retry or result handling.

This keeps the compatibility side effect in the user-facing workflow, where the legacy GAS menu initiated auditing after successful updates, while avoiding an invasive side effect for direct API callers.

### Problem

Bkper already updates balances from accepted complete movements, and an additional Book audit may be redundant. Auditing after every mutating Exchange Update adds work and may obscure whether the workflow depends on repair behavior that should not be necessary. The migration must preserve accepted behavior long enough to validate the cutover, but preservation alone does not justify retaining this call permanently.

### Intended review

After migration stabilization, determine from production evidence whether Exchange Update requires an explicit audit at all. If not, remove the client call without adding an API-side replacement.

### Acceptance criteria

- The review establishes whether any correctness or recovery behavior depends on the explicit audit.
- Until that review, only successful responses containing accepted transactions trigger one target-Book audit.
- No-op, failed, and Account-only responses do not trigger an audit.
- Audit triggering never retries or changes the outcome of an accepted Exchange Update mutation.
- Removing the compatibility call must not change movement direction, amount, transaction state, returned resources, or the zero-sum invariant.
