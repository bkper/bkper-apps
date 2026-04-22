# Inventory Bot — Revised Implementation Plan

> Purpose: fix the confirmed COGS deletion/rebuild bug and align the README with actual behavior, **without changing FIFO behavior, movement directions, or balance integrity**.

---

## Goal

Deliver a **minimal, safe change set** that:

1. Fixes the confirmed bug in COGS deletion detection.
2. Adds regression tests **before** changing runtime code.
3. Corrects README statements that currently do not match source behavior.
4. Avoids introducing broader behavioral changes or unsupported feature work.

---

## Guardrails

- **Protect the zero-sum invariant above all else.**
- Do **not** change transaction amounts, `from >> to` directions, or posting semantics.
- Do **not** refactor FIFO or mirror creation logic unless required to make the bug testable.
- For any runtime code change, **tests come first**.
- README must document **only source-verified behavior**.
- Keep scope tight: bug fix + tests + docs only.

---

## Non-Goals

This plan does **not** include:

- implementing support for editing checked transactions
- refactoring FIFO processing
- changing how purchases/sales are mirrored
- redesigning account sync behavior
- changing Inventory Book detection rules as a product feature
- adding new bookkeeping behavior

---

## Phase 0 — Baseline Verification

### Objective

Confirm current behavior and ensure changes can be validated safely before touching runtime logic.

### Tasks

- [ ] Confirm the COGS mismatch in source:
  - `events/src/constants.ts`
  - `menu/server/src/CalculateCostOfSalesService.ts`
  - `events/src/InterceptorOrderProcessorDeleteFinancial.ts`
- [ ] Reconfirm README claims against source for all planned documentation updates.
- [ ] Verify local build/test workflow for:
  - `events`
  - `menu/server`
- [ ] If test commands fail due to missing installs, install dependencies first.
- [ ] If test commands still fail due to a repo/tooling issue, stop and document that blocker before changing runtime logic.

### Exit Criteria

- We know exactly which files are in scope.
- We know which behaviors are confirmed bugs vs. undocumented current behavior.
- Test/build commands are runnable, or a tooling blocker is explicitly identified first.

---

## Phase 1 — Mandatory Regression Tests First

### Objective

Add the smallest possible tests that fail on current behavior and protect against regressions.

### Tasks

#### T1 — COGS deletion detection behavior

- [ ] Add a minimal unit test proving that deleting a bot-generated COGS transaction triggers the rebuild-flag path.
- [ ] Prefer testing behavior, not just a raw string constant.

#### T2 — Credit note without quantity

- [ ] Add a minimal unit test proving that a checked credit note with **missing quantity** does **not** create an Inventory Book mirror.

#### T3 — Credit note with zero quantity

- [ ] Add a minimal unit test proving that a checked credit note with **quantity = 0** does **not** create an Inventory Book mirror.

#### T4 — Optional compatibility test

- [ ] If the implementation supports both COGS markers, add a test covering both accepted markers.

### Notes

- If current structure makes T1 too hard to test cleanly, extract the **smallest possible pure helper/predicate** needed for isolation.
- Do **not** refactor unrelated logic to improve testability.

### Exit Criteria

- New tests exist before runtime changes.
- At least one test fails against the current bugged behavior.
- Test scope stays minimal and behavioral.

---

## Phase 2 — Implement the Smallest Safe Runtime Fix

### Objective

Fix only the confirmed COGS deletion detection bug, with the least risky change possible.

### Preferred Fix Strategy

1. [ ] Make deletion detection recognize the **actual** bot-generated COGS transaction format.
2. [ ] Prefer a more stable signal than description text when possible:
   - `agentId`
   - `quantity_sold`
   - `remoteIds`
3. [ ] If full marker hardening is too invasive for this pass, at minimum support:
   - current `#COGS`
   - and preferably legacy `#cost_of_sale` too

### In-Scope Files

- `events/src/constants.ts`
- `events/src/InterceptorOrderProcessorDeleteFinancial.ts`

### Out of Scope

- No changes to:
  - COGS amount calculation
  - COGS account posting direction
  - FIFO liquidation behavior
  - mirror creation rules

### Exit Criteria

- All Phase 1 tests pass.
- The bug is fixed without changing unrelated bookkeeping behavior.
- Repo-wide search confirms there are no conflicting remaining references.

---

## Phase 3 — README Corrections (Source-Verified Only)

### Objective

Update docs so users understand the current system accurately, without documenting unsupported or partial behavior as if it were a product guarantee.

### Critical Corrections

#### D1 — Credit notes without quantity

- [ ] Clarify that credit notes with **missing quantity or quantity = 0** are **not mirrored** to the Inventory Book.
- [ ] Clarify that they affect COGS only during calculation through `purchase_code` lookup on the Financial Book side.

#### D2 — 2-month lookup window

- [ ] Document that additional costs and credit notes are only picked up within the configured **2-month query range** from the original purchase date.

#### D3 — Auto-created good accounts on sale

- [ ] Warn that if the `good` account does not exist in the Inventory Book, the bot auto-creates it.
- [ ] Warn that typos can create phantom inventory accounts.

#### D4 — Quantity on additional costs

- [ ] Clarify that adding `quantity` to an additional-cost transaction makes it behave like a purchase mirror and can create unintended units.

### Behavior Documentation

#### D5 — `remoteId` linkage

- [ ] Explain that mirrored transactions are linked across books using `remoteId`.

#### D6 — FIFO splitting

- [ ] Explain that FIFO may split purchase transactions and use `parent_id` for traceability.

#### D7 — Bot-managed properties

- [ ] Document the main bot-managed properties users may see, including:
  - `original_quantity`
  - `good_purchase_cost`
  - `total_cost`
  - `parent_id`
  - `purchase_log`
  - `liquidation_log`
  - `sale_amount`
  - `quantity_sold`
  - `additional_costs`
- [ ] Make clear these are internal/bot-managed fields.

#### D8 — Account sync on purchases

- [ ] Reword carefully:
  - the bot syncs account properties, archived status, and group membership from the Financial Book account
  - it creates missing **direct groups when possible**
- [ ] Do **not** claim full recursive hierarchy sync.

#### D9 — `exc_code` mismatch behavior

- [ ] Clarify precisely:
  - event mirroring is skipped when the resolved good/account exchange code does not match the Financial Book exchange code
  - later calculation may surface this as `financial book not found...`

#### D10 — Inventory Book detection

- [ ] Keep `inventory_book: true` documented as **required**.
- [ ] Do **not** document the menu-layer `fractionDigits == 0` fallback as supported user configuration.

#### D11 — Account type requirement

- [ ] State that inventory item accounts should be `ASSET`.
- [ ] Clarify that book-wide/group-wide Calculate and Reset operate on `ASSET` accounts.
- [ ] Clarify that selecting a non-Asset account directly is unsupported.

#### D12 — Editing checked transactions

- [ ] Document that editing checked transactions is unsupported.
- [ ] Instruct users to delete/re-enter, then Reset and Calculate.

#### D13 — Hardcoded COGS account name

- [ ] Document that the bot uses the Financial Book account name **Cost of goods sold**.

#### D14 — Unchecking in Financial Book

- [ ] Clarify that unchecking a Financial Book transaction does **not** undo or remove the Inventory Book mirror.
- [ ] Tell users to delete/re-enter and/or Reset + Calculate when they need a full rollback.

### Minor Clarifications Only If Source-Backed

#### Keep

- [ ] `cogs_calc_date` is stored as `YYYY-MM-DD`
- [ ] decimal quantities are supported
- [ ] Inventory Book transactions are auto-checked during COGS calculation, and checked transactions are skipped by FIFO
- [ ] `Buy` and `Sell` accounts are auto-created if missing

#### Do Not Add

- [ ] Do **not** claim that `order` applies to additional costs and credit notes unless code is explicitly changed and tested to support that behavior.

---

## Phase 4 — Documentation QA Pass

### Objective

Make sure the README is accurate, precise, and not misleading.

### Tasks

- [ ] Re-read all updated sections end-to-end.
- [ ] Remove any statement that turns an internal heuristic into a supported feature.
- [ ] Ensure warnings are operationally useful:
  - phantom accounts
  - skipped transactions
  - rebuild requirements
  - unsupported edit flows
- [ ] Cross-check all documented property names against source constants.

### Exit Criteria

- README matches the current codebase.
- No doc statement over-promises unsupported behavior.

---

## Phase 5 — Final Verification

### Objective

Prove the implementation is safe and did not introduce regressions.

### Tasks

- [ ] Run `events` tests/build.
- [ ] Run `menu/server` tests/build.
- [ ] Search repo for:
  - `#COGS`
  - `#cost_of_sale`
  - `inventory_book`
  - `TRANSACTION_UPDATED`
  - documented property names
- [ ] Reconfirm that no runtime change altered:
  - movement directions
  - transaction amounts
  - account types used for postings

### Acceptance Criteria

- [ ] Tests pass.
- [ ] Build passes.
- [ ] Runtime scope stayed limited to the confirmed COGS deletion detection fix.
- [ ] README is source-verified and does not document unsupported behavior as supported.

---

## Disposition of Original Plan Items

### Keep

- B1
- D1–D7
- D9
- D12
- D13

### Keep, but Rewrite

- D8
- D11
- D14

### Remove from End-User README

- D10 as originally proposed

### Defer Unless Code Changes

- D15a (`order` applying to additional costs/credit notes)

### Make Mandatory

- T1
- T2
- T3

---

## Task Checklist

```markdown
- [ ] Phase 0  Baseline verification completed
- [ ] T1       Add COGS deletion detection regression test
- [ ] T2       Add missing-quantity credit note test
- [ ] T3       Add zero-quantity credit note test
- [ ] T4       Add compatibility test if dual-marker support is implemented
- [ ] B1       Implement minimal, safe COGS deletion detection fix
- [ ] D1       Clarify credit notes without/zero quantity do not mirror
- [ ] D2       Document 2-month lookup window
- [ ] D3       Warn about auto-created good accounts on sale
- [ ] D4       Explain why quantity must not be set on additional costs
- [ ] D5       Document `remoteId` linkage
- [ ] D6       Document FIFO transaction splitting
- [ ] D7       List bot-managed/internal properties
- [ ] D8       Document limited account sync behavior on purchases
- [ ] D9       Document precise `exc_code` mismatch behavior
- [ ] D10      Keep `inventory_book: true` as required
- [ ] D11      Document Asset-account requirement precisely
- [ ] D12      Document unsupported checked-transaction edits
- [ ] D13      Document hardcoded COGS account name
- [ ] D14      Clarify unchecking in Financial Book does not undo mirror
- [ ] D15      Add only source-backed minor clarifications
- [ ] Phase 4  Documentation QA pass completed
- [ ] Phase 5  Final verification completed
```

---

## Dependency Order

1. **Phase 0** — verify scope and testability
2. **Phase 1** — add tests first
3. **Phase 2** — implement minimal runtime fix
4. **Phase 3** — update README
5. **Phase 4** — documentation QA pass
6. **Phase 5** — final verification
