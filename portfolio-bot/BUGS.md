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

## 4. BotService and operation processors have mixed responsibilities

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

The Calculate and Reset processors preserve their legacy mutation queues and ordered batch phases. They also retain supporting behavior such as lock accumulation and, for Calculate, temporary-id generation, remote-id classification, date conversion, and MTM balance accumulation.

### Problem

`BotService` has no clear, bounded responsibility. It mixes pure calculations, chart reads, cross-Book resolution, query construction, and mutation-capable resource creation. The processors also mix their core ordered-mutation role with supporting calculations and identifier handling. Unrelated changes therefore converge on broad classes, making behavior, authorization, mutation order, and zero-sum safeguards harder to understand, test, and audit.

No authorization bypass or other concrete security vulnerability is currently confirmed. The structure is an architectural and auditability risk that can hide future mistakes if it remains after migration.

### Intended improvement

After migration stabilization:

- Inventory every `BotService` call site and every Calculate and Reset processor method across Calculate, Reset, Forward Date, context loading, and shared operation preflight.
- Define one narrow meaning for any retained `BotService`, such as genuinely bot-wide Book-role or operation-context resolution, or remove the class if no cohesive responsibility remains.
- Move operation-specific behavior beside Calculate, Reset, or Forward Date.
- Keep processors focused on mutation queueing, deduplication, lock state, canonical relationship rewiring, and ordered batch execution.
- Move pure operation-specific calculations and classifications beside their owning operation when a cohesive boundary is established.
- Extract shared behavior only when multiple real consumers require the same domain rule.
- Prefer cohesive domain modules over generic `utils` files or one file per method.
- Separate pure calculations and lookups from resource creation and other mutations.
- Keep mutation-capable behavior behind the established authorization, installation, lock, and complete-operation preflight boundaries.
- Perform the refactor incrementally with existing behavior characterized before each move.

### Acceptance criteria

- Every retained service or module has one documented responsibility and clear dependency direction.
- Calculate-, Reset-, and Forward-specific behavior lives with its owning operation.
- Processors retain only behavior required to coordinate deterministic mutation phases and relationships.
- Shared modules have multiple concrete consumers or represent an explicitly shared domain boundary.
- Generic miscellaneous utility modules do not replace the current catch-all service.
- Pure calculation helpers cannot create or mutate Bkper resources.
- Resource creation and other mutations remain explicit and occur only after the established preflight boundaries.
- Accounting outcomes, Map and Set replacement semantics, canonical-id relationships, lookup and mutation order, API contracts, and the per-Book zero-sum invariant remain unchanged.
- Existing deterministic parity tests continue to pass, with focused characterization added before moving insufficiently covered behavior.
- Tests do not access or write to live Books.
