# Deferred Bugs and Improvements

This document tracks known Portfolio Bot bugs and architectural improvements that are intentionally deferred during the Cloudflare migration to maintain production parity. Address them after migration stabilization, each with dedicated tests and review.

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

## 3. Full Reset availability checks unrelated Collection Books

**Status:** Deferred until after migration stabilization.

### Current legacy behavior

Portfolio Bot enables Full Reset only when the Portfolio Book grants OWNER permission and every Book in the originating Collection has no effective lock or closing date. Missing dates and the legacy `1900-00-00` sentinel are treated as unlocked and open.

The migrated client preserves this Collection-wide check for parity with the legacy GAS menu.

### Problem

A Full Reset does not mutate every Book in the Collection. For the complete selected Account or Group scope, it can mutate only:

- the Portfolio Book;
- the Base Book; and
- the Financial Books matching the selected Accounts' exchange currencies.

A locked or closed Book for an unrelated currency can therefore disable Full Reset even though the operation would not read or mutate that Book. The Collection-wide check is a conservative legacy shortcut rather than a requirement of the Full Reset movement model.

### Intended fix

Preflight only the complete Book scope that the selected Full Reset can mutate:

- Resolve every selected Account before the first write.
- Resolve the Portfolio Book, Base Book, and the union of matching Financial Books for all selected Account currencies.
- Check owner, installation, edit permission, lock, and closing requirements on that complete target set before starting any Account-level mutation.
- Do not perform preflight independently immediately before each Account operation, because an earlier Account could be mutated before a later target fails.
- Keep transaction-level locked-resource detection and Bkper Core enforcement authoritative after the application preflight.

### Acceptance criteria

- An unrelated locked or closed Financial Book does not disable Full Reset.
- A locked or closed Portfolio Book, Base Book, or selected-currency Financial Book blocks Full Reset.
- Account scope preflights its one selected currency; Group scope preflights the union of all selected currencies.
- Missing target Books and insufficient target permissions remain blocking.
- Every target Book is preflighted before the first Account, Transaction, or Book mutation begins.
- A failed scoped preflight produces no mutation in any participating Book.
- Missing lock and closing dates and the legacy `1900-00-00` sentinel remain treated as unlocked and open.
- Deterministic tests cover Account, multi-currency Group, unrelated-Book, and no-side-effect failure cases without accessing live Books.

## 4. BotService has mixed responsibilities

**Status:** Deferred until after migration stabilization.

### Current legacy behavior

The legacy GAS `BotService` namespace and the migrated server `BotService` collect behavior from unrelated domains, including:

- Portfolio, Financial, and Base Book role resolution;
- exchange-code and Account context resolution;
- date and Transaction query construction;
- calculation-model, FIFO, price, rate, and gain rules;
- pending-calculation discovery; and
- support Account lookup, inference, and creation.

The migration preserves this structure where required for parity rather than redesigning operation behavior while accounting outcomes are still being ported.

### Problem

`BotService` has no clear, bounded responsibility. It mixes pure calculations, chart reads, cross-Book resolution, query construction, and mutation-capable resource creation. Unrelated changes therefore converge on one broad class, making behavior, authorization, lookup order, mutation boundaries, and zero-sum safeguards harder to understand, test, and audit.

No authorization bypass or other concrete security vulnerability is currently confirmed. The structure is an architectural and auditability risk that can hide future mistakes if it remains after migration.

### Intended improvement

After migration stabilization:

- Inventory every `BotService` call site across Calculate, Reset, Forward Date, context loading, and shared operation preflight.
- Define one narrow meaning for any retained `BotService`, such as genuinely bot-wide Book-role or operation-context resolution, or remove the class if no cohesive responsibility remains.
- Move operation-specific behavior beside Calculate, Reset, or Forward Date.
- Move pure operation-specific calculations and classifications beside their owning operation when a cohesive boundary is established.
- Extract shared behavior only when multiple real consumers require the same domain rule.
- Prefer cohesive domain modules over generic `utils` files or one file per method.
- Separate pure calculations and lookups from resource creation and other mutations.
- Keep mutation-capable behavior behind the established authorization, installation, lock, and complete-operation preflight boundaries.
- Perform the refactor incrementally with existing behavior characterized before each move.

### Acceptance criteria

- Every retained service or module has one documented responsibility and clear dependency direction.
- Calculate-, Reset-, and Forward-specific behavior lives with its owning operation.
- Shared modules have multiple concrete consumers or represent an explicitly shared domain boundary.
- Generic miscellaneous utility modules do not replace the current catch-all service.
- Pure calculation helpers cannot create or mutate Bkper resources.
- Resource creation and other mutations remain explicit and occur only after the established preflight boundaries.
- Accounting outcomes, lookup and mutation order, API contracts, and the per-Book zero-sum invariant remain unchanged.
- Existing deterministic parity tests continue to pass, with focused characterization added before moving insufficiently covered behavior.
- Tests do not access or write to live Books.

## 5. Calculate mixes orchestration, lookups, resource creation, and movement construction

**Status:** Deferred until after migration stabilization.

### Current migration behavior

The Calculate migration deliberately preserves the legacy behavior and method boundaries while accounting parity is established:

- `CalculateRealizedResultsService` owns Account-level orchestration and the complete `processSale` method.
- `CalculateRealizedResultsSupport` is a temporary file-level boundary for the already-ported helper methods.
- `CalculateRealizedResultsProcessor` preserves the legacy mutation queues, canonical-id replacement, lock accumulation, MTM accumulation, and ordered Portfolio, Financial, and Base Book batch phases.

`CalculateRealizedResultsSupport` currently combines:

- log construction and FIFO classification;
- exchange-rate property resolution and queued Portfolio Transaction updates;
- balance reads and Account and Group lookups;
- support Account inference and creation;
- realized, FX, MTM, historical MTM, and interest-MTM movement construction and queueing; and
- Portfolio Account realized-date updates.

The support split makes the parity port easier to navigate, but it is not intended as the final Calculate architecture. The migration keeps `processSale` intact and does not redistribute these responsibilities before preview and production stabilization.

### Problem

The Calculate module places pure derivation, SDK reads, chart mutation, movement construction, mutation queueing, relationship handling, and Account-state updates behind broad classes. The generic `Support` boundary improves file size but does not provide one cohesive domain responsibility.

The complete `processSale` workflow is also branch-dense: it coordinates FIFO lots, complete and partial liquidation, short sales, split Transactions, historical and fair models, MTM behavior, properties, remote ids, and relationships. Combined with the broad support and processor dependencies, this makes movement amounts, directions, canonical relationships, no-op behavior, asynchronous ordering, and failure boundaries difficult to audit.

No concrete accounting bug is confirmed solely from this structure. It is an architectural and auditability risk that can conceal inherited or future mistakes, especially mistakes that could create an incomplete, reversed, duplicated, or incorrectly related movement.

### Intended improvement

After migration stabilization:

- Inventory every `CalculateRealizedResultsService`, `CalculateRealizedResultsSupport`, and `CalculateRealizedResultsProcessor` responsibility and call path before moving behavior.
- Characterize every `processSale` branch, including long and short sales, complete and partial lots, splits, all calculation models, realized and FX results, MTM variants, properties, remote ids, checked state, and canonical relationships.
- Replace the generic support boundary with cohesive Calculate domain modules rather than another catch-all helper or one file per method.
- Separate pure amount, rate, classification, and log derivation from Bkper SDK reads and mutations.
- Separate chart lookup from support Account creation so resource provisioning remains explicit.
- Keep movement construction explicit about amount, origin Account, destination Account, properties, remote ids, and source relationships.
- Keep the processor focused on mutation queueing, deduplication, lock state, canonical relationship rewiring, MTM accumulation required for ordered results, and deterministic batch execution.
- Refactor `processSale` only in small characterized steps; do not introduce a rules engine, strategy hierarchy, or redesigned calculation pipeline without evidence that it improves the domain boundary.
- Keep every mutation behind the established authorization, installation, lock, and complete-operation preflight boundaries.
- Treat any intentional accounting correction discovered during the work as a separate bug with its own deterministic test, preview evidence, and rollout decision.

### Acceptance criteria

- The Calculate service, support replacements, and processor each have one documented responsibility and clear dependency direction.
- No generic `Support`, `Helpers`, or `Utils` catch-all remains.
- Pure calculations and classifications cannot read, create, or mutate Bkper resources.
- Account and Group reads are distinguishable from support Account creation.
- Movement builders always produce one amount with one origin Account and one destination Account, or explicitly produce no movement.
- Canonical ids, parent and remote ids, split relationships, checked state, and ordered Portfolio, Financial, and Base Book mutation phases remain deterministic.
- Locked, unresolved, zero-result, and failed-preflight paths produce no unintended movement.
- Existing accounting outcomes remain unchanged unless a separately approved bug fix intentionally changes them.
- The complete deterministic Calculate matrix and per-Book zero-sum assertions pass without accessing live Books.
