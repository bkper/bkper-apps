# Deferred Bug Fixes

This document tracks known Tax Bot bugs that are intentionally preserved during the Cloudflare migration to maintain production parity. Address them only after migration stabilization, each with dedicated deterministic tests and preview review.

## 1. Posted-result messages can contain an undefined date

**Status:** Open; confirmed in production stabilization logs.

### Current legacy behavior

After batch creation, Tax Bot builds each informational result from the returned Transaction's `getDateFormatted()` value. The batch API can omit the optional `dateFormatted` field even though the canonical stored Transaction has the correct date. In that case, the response is rendered in this form:

```text
POSTED: undefined 0.10 #tax_canary Example
```

The legacy and Cloudflare handlers use the same response expression, and `bkper-js` 2.18.0 and 2.19.0 use identical batch-creation and `getDateFormatted()` implementations. The migration therefore preserves this behavior.

### Problem

The generated movement is correct, but the activity response is confusing and appears to report missing Transaction data. Users cannot rely on the response text as a clear summary of the created entry.

### Intended fix

Produce a stable Book-formatted date when `dateFormatted` is absent, using an already available canonical date value or another deterministic fallback. Do not add a mutation, change batch ordering, or alter the generated Transaction to repair presentation text.

### Acceptance criteria

- A returned `dateFormatted` value remains unchanged.
- A missing `dateFormatted` value produces the correct date in the Book's configured pattern.
- The fallback does not create, update, post, check, or trash any additional Transaction.
- Batch ordering, amounts, movement direction, remote ids, descriptions, and result ordering remain unchanged.
- Deterministic tests cover present and missing formatted-date fields without network access or live Books.

## 2. Numeric source-description text can be removed from generated descriptions

**Status:** Open; preserved during migration and not revalidated in production stabilization.

### Current legacy behavior

Tax Bot substitutes `${transaction.description}` into `tax_description` and delegates the resulting string to Bkper for Account resolution. Bkper's Transaction description parser can interpret a numeric token in that substituted text as structural amount input and remove it from the generated Transaction's visible description.

For example, a source description containing:

```text
Chunk 10 included-tax canary
```

can produce a generated visible description containing:

```text
Chunk included-tax canary
```

The explicitly assigned tax amount and resolved movement remain correct. This parsing path is shared by the legacy and Cloudflare implementations.

### Problem

Generated tax entries can silently lose meaningful numeric text such as quantities, invoice fragments, years, or identifiers. The generated description no longer faithfully preserves the configured expression result even though the accounting movement is correct.

### Intended fix

Preserve substituted description text without allowing its numeric tokens to be reinterpreted as movement structure. Review the Core parser contract first, then choose the smallest fix that retains deterministic Account resolution and draft behavior.

### Acceptance criteria

- Numeric tokens from `${transaction.description}` remain visible in the generated tax description.
- The configured tax amount cannot be replaced or reinterpreted by numeric description text.
- Complete descriptions still resolve exactly one origin Account and one destination Account.
- Unresolved descriptions remain drafts and have no balance effect.
- The source Transaction remains unchanged.
- Amount, direction, state, remote id, property handling, idempotency, and the zero-sum invariant remain unchanged.
- Deterministic tests cover numeric descriptions, non-numeric descriptions, and unresolved Accounts without network access or live Books.

## 3. Generated tax Transaction properties are emitted to runtime logs

**Status:** Open; inherited production behavior confirmed during stabilization.

### Current legacy behavior

Tax Bot logs the complete generated Transaction property map immediately before batch creation. The Cloudflare migration preserved this statement for parity with GCP. Because eligible visible source properties are copied to generated tax Transactions, the log payload can include customer-defined business metadata.

Production stabilization observed one property-map log for each of the 281 reported tax-creation results. The review retained only aggregate evidence and did not copy customer values into this public ledger.

### Problem

Runtime logs can retain customer-defined metadata that is not required to operate or diagnose Tax Bot. This increases privacy exposure and makes production logs harder to share safely during incident review.

### Intended fix

Remove property-value logging. If operational evidence is still needed, emit only bounded, non-sensitive structural information that cannot reveal property keys or values. Do not alter property copying, Transaction construction, batch ordering, or any movement behavior.

### Acceptance criteria

- Runtime logs contain no customer-defined Transaction property keys or values.
- Generated Transactions retain the same eligible visible properties.
- Amount, direction, state, description, remote id, ordering, idempotency, and the zero-sum invariant remain unchanged.
- The source Transaction remains unchanged.
- Deterministic tests verify the privacy boundary without credentials, network access, or live Books.

## 4. Provider-free SDK calls produce high-volume warning noise

**Status:** Open; Cloudflare production behavior confirmed during stabilization.

### Current behavior

The platform Worker correctly creates request-scoped `Bkper` instances without token providers so platform outbound authentication can supply user and app identity. The pinned SDK emits `Token provider NOT configured!` while making authenticated platform-proxied API calls.

In the fixed stabilization window, 4,382 of 14,168 successful requests were classified at warning level because they emitted 8,691 instances of this message. All requests completed with HTTP 200, and no authentication error or error response envelope accompanied the warning.

### Problem

Expected authentication-boundary noise causes successful requests to appear warning-level and can obscure actionable warnings during production monitoring.

### Intended fix

Remove the expected warning at the SDK or platform boundary without configuring a legacy inbound token provider and without suppressing genuine authentication, permission, network, retry, or server failures. Treat any SDK upgrade as the separate compatibility work required by the migration roadmap.

### Acceptance criteria

- Successful platform-authenticated API calls do not emit the expected missing-provider warning.
- Worker code remains provider-free and does not read or forward inbound authentication headers.
- Authentication and authorization failures remain observable.
- Non-authentication warnings, retries, and errors remain observable.
- Tax calculations, generated movements, lifecycle behavior, idempotency, and response envelopes remain unchanged.
- Deterministic tests exercise the logging boundary without credentials, network access, or live Books.
