# Subledger Bot

The Subledger Bot connects books in a parent–child relationship, automatically consolidating transactions from subledger books into a general ledger. Each subledger operates independently — with its own accounts, permissions, and workflows — while the parent book provides a unified view.

This is useful for dividing work between teams (e.g. one team tracking receivables, another tracking payables) or consolidating subsidiary books into a single parent book.

## How it works

The bot listens for events in child books. When a transaction is posted in a child book, the bot records a corresponding transaction in the parent book, mapping child accounts to parent accounts based on configured properties.

```mermaid
flowchart BT
    subgraph child1["Subledger: Receivables"]
        C1A["Customer A"]:::asset
        C1B["Customer B"]:::asset
        C1R["Service A"]:::incoming
    end

    subgraph child2["Subledger: Payables"]
        C2S["Supplier X"]:::liability
        C2E["Rent"]:::outgoing
    end

    subgraph parent["General Ledger"]
        PAR["Accounts Receivable"]:::asset
        PAP["Accounts Payable"]:::liability
        PR["Revenue"]:::incoming
        PE["Expenses"]:::outgoing
    end

    child1 -- "bot consolidates" --> parent
    child2 -- "bot consolidates" --> parent

    classDef asset fill:#dfedf6,stroke:#3478bc,color:#3478bc
    classDef liability fill:#fef3d8,stroke:#cc9200,color:#cc9200
    classDef incoming fill:#e2f3e7,stroke:#228c33,color:#228c33
    classDef outgoing fill:#f6deda,stroke:#bf4436,color:#bf4436
```

The bot also syncs accounts from parent to child — when you add an account to a synced group on the parent, the bot creates it on the child book automatically.

## Consolidating transactions

When you post a transaction on a child book, the bot maps child accounts to parent accounts and records the transaction on the parent.

**You post on the child book (Receivables):**

```
05/03  300.00  Service B  >>  Customer A  Invoice #1042
```

**The bot records on the parent book (General Ledger):**

```
05/03  300.00  Service B  >>  Accounts Receivable  Invoice #1042
```

The bot resolves each account in three steps:
1. Check the child account for a `parent_account` property
2. Check the child account's groups for a `parent_account` property
3. Fall back to a parent account with the same name

In this example, *Customer A* is in a group with `parent_account: Accounts Receivable`, so it maps to the consolidated account. *Service B* exists on both books (synced via `child_book_id`), so it maps by name.

```mermaid
flowchart LR
    subgraph child["Child Book"]
        CA["Customer A"]:::asset
        CB["Customer B"]:::asset
    end

    subgraph parent["Parent Book"]
        AR["Accounts Receivable"]:::asset
    end

    CA -- "parent_account" --> AR
    CB -- "parent_account" --> AR

    classDef asset fill:#dfedf6,stroke:#3478bc,color:#3478bc
```

| # | Book | Amount | From | | To | Description |
|---|---|---|---|---|---|---|
| You | Child | **300.00** | Service B `Incoming` | >> | Customer A `Asset` | Invoice #1042 |
| Bot | Parent | **300.00** | Service B `Incoming` | >> | Accounts Receivable `Asset` | Invoice #1042 |

The bot preserves the original description and adds `child_from` and `child_to` properties on the parent transaction so you can trace it back to the original child accounts.

## Syncing accounts

For non-permanent accounts (revenue, expenses) that should exist on both parent and child books, set `child_book_id` on a group in the parent book. When you add an account to that group, the bot creates it on the child book.

```mermaid
flowchart RL
    subgraph parent["Parent Book"]
        PG["Revenue group<br/>child_book_id: abc123"]
        PA["Service C"]:::incoming
    end

    subgraph child["Child Book"]
        CA["Service C"]:::incoming
    end

    PA -- "bot creates" --> CA

    classDef incoming fill:#e2f3e7,stroke:#228c33,color:#228c33
```

This keeps shared account structures in sync without manual duplication. The bot also syncs account updates and deletions.

## Configuration

<details>
<summary><strong>Child book properties</strong></summary>

Set on the child book's book properties to establish the parent–child relationship.

| Property | Description |
|---|---|
| `parent_book_id` | The `bookId` of the parent book. Found in the book URL: `app.bkper.com/b/#transactions:bookId=<id>`. Also accepts the legacy key `parent_book` |

All books in the subledger structure (parent and children) must be part of the same [Collection](https://bkper.com/docs/guides/using-bkper/books). The bot must be installed on all participating books.

```yaml
parent_book_id: agtzfmJrcGVyLWhyZBcLEgpHbHhBY291bnQY
```

</details>

<details>
<summary><strong>Account & Group properties (child book)</strong></summary>

Set on accounts or groups in the child book to define how they map to the parent.

| Property | Description |
|---|---|
| `parent_account` | Name of the account on the parent book that this child account (or group of accounts) maps to. When set on a group, all accounts in that group map to the same parent account |

**Example — map an entire receivables group to one parent account:**

```yaml
# Group: Accounts Receivable (child book)
parent_account: Accounts Receivable A
```

All transactions involving Customer A, Customer B, etc. are recorded on the parent using `Accounts Receivable A`. If the parent account doesn't exist yet, the bot creates it automatically.

> When `parent_account` is not set, the bot looks for a parent account with the same name as the child account. If neither account can be resolved on the parent, the transaction is created as a draft for manual resolution.

</details>

<details>
<summary><strong>Transaction properties</strong></summary>

Optional properties to control how individual transactions are consolidated.

| Property | Description |
|---|---|
| `parent_amount` | Amount to record on the parent book instead of the child transaction's amount. Set to `0` to skip consolidation entirely |

**Example — record a different amount on parent:**

```yaml
parent_amount: 250.00
```

The child transaction keeps its original amount, but the parent gets 250.00.

</details>

<details>
<summary><strong>Group properties (parent book)</strong></summary>

Set on groups in the parent book to enable account syncing from parent to child.

| Property | Description |
|---|---|
| `child_book_id` | The `bookId` of the child book to sync accounts to. When an account is added to this group on the parent, the bot creates it on the child book |

```yaml
# Group: Revenue (parent book)
child_book_id: agtzfmJrcGVyLWhyZBcLEgpHbHhBY291bnQY
```

> This requires the Subledger Bot to be installed on the parent book as well.

</details>

## Examples

<details>
<summary><strong>Permanent accounts — many-to-one consolidation</strong></summary>

The child book has individual customer accounts grouped under *Accounts Receivable* with `parent_account: Accounts Receivable A`. The parent book has a single *Accounts Receivable A* account.

| # | Book | Amount | From | | To |
|---|---|---|---|---|---|
| You | Child | **200.00** | Service A `Incoming` | >> | Customer A `Asset` |
| Bot | Parent | **200.00** | Service A `Incoming` | >> | Accounts Receivable A `Asset` |
| You | Child | **300.00** | Service B `Incoming` | >> | Customer A `Asset` |
| Bot | Parent | **300.00** | Service B `Incoming` | >> | Accounts Receivable A `Asset` |

**Result:** Child book shows 500.00 receivable from Customer A. Parent book shows 500.00 in Accounts Receivable A — consolidated from all customers.

The parent transactions include `child_from` and `child_to` properties for traceability.

</details>

<details>
<summary><strong>Non-permanent accounts — shared account sync</strong></summary>

Revenue and expense accounts should exist on both books. Set `child_book_id` on the parent's Revenue group.

| # | Book | What happens |
|---|---|---|
| You | Parent | Add "Service C" to Revenue group |
| Bot | Child | Account "Service C" created automatically |

Now when a transaction is posted on the child using Service C, the bot records it on the parent using the same account name.

</details>

<details>
<summary><strong>Custom amounts with parent_amount</strong></summary>

When the parent should reflect a different amount (e.g. after tax deductions), set `parent_amount` on the child transaction.

| # | Book | Amount | From | | To | Note |
|---|---|---|---|---|---|---|
| You | Child | **1,100.00** | Revenue `Incoming` | >> | Client `Asset` | Full amount with tax |
| Bot | Parent | **1,000.00** | Revenue `Incoming` | >> | Accounts Receivable `Asset` | `parent_amount: 1000` |

Set `parent_amount: 0` to skip recording on the parent entirely.

</details>

<details>
<summary><strong>Events handled</strong></summary>

The bot responds to the following Bkper events:

| Event | Direction | Behavior |
|---|---|---|
| `TRANSACTION_POSTED` | Child → Parent | Records corresponding transaction on parent |
| `TRANSACTION_CHECKED` | Child → Parent | Checks the corresponding transaction on parent |
| `TRANSACTION_UPDATED` | Child → Parent | Updates the corresponding transaction on parent |
| `TRANSACTION_DELETED` | Child → Parent | Deletes the corresponding transaction on parent |
| `TRANSACTION_RESTORED` | Child → Parent | Restores the corresponding transaction on parent |
| `ACCOUNT_CREATED` | Parent → Child | Creates account on child (via `child_book_id` group) |
| `ACCOUNT_UPDATED` | Parent → Child | Updates account on child |
| `ACCOUNT_DELETED` | Parent → Child | Deletes account on child |
| `GROUP_CREATED` | Parent → Child | Creates group on child |
| `GROUP_UPDATED` | Parent → Child | Updates group on child |
| `GROUP_DELETED` | Parent → Child | Deletes group on child |

> Transactions originating from the Exchange Bot are automatically skipped to avoid duplication.

</details>

## Learn more

- [Structuring Books & Collections](https://bkper.com/docs/guides/accounting-principles/modeling/structuring-books-collections) — how bots connect books for consolidated reporting
- [Tracking departments & projects](https://bkper.com/docs/guides/accounting-principles/modeling/tracking-departments-projects) — approaches to segment-level bookkeeping
