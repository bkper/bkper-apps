# Deferred Bug Fixes

This document tracks known Exchange Bot bugs that are intentionally preserved during the Cloudflare migration to maintain production parity. Address these fixes as soon as the migration is stabilized, each with dedicated tests and review.

## 1. Editable exchange rates accept non-numeric text

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

## 2. Exchange Update retries lack delay and structured error classification

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

## 3. Client-triggered post-update Book audits may be unnecessary

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
