# Bookbot

Finds the right accounts for your transactions. Bookbot looks at how you recorded similar transactions before and suggests the missing From or To account, and the custom properties they always share.

Apps, scripts, and agents ask Bookbot for accounts through its [API](#api-access).

Bookbot never posts transactions and never replaces an account or property you already set.

## How it works

```mermaid
sequenceDiagram
    participant App as Your app
    participant Bookbot as Bookbot
    participant Book as Bkper Book

    App->>Bookbot: Which accounts for these drafts?
    Bookbot->>Book: Search posted transactions
    Bookbot-->>App: Suggested accounts and properties
    Note over Book: Drafts reviewed and posted
    Book->>Bookbot: Account corrected on a posted transaction
    Bookbot->>Book: Re-check pending drafts
```

## Account discovery

Bookbot assigns missing From and To accounts from your book's posted transactions:

1. **Identify key terms** — AI picks out meaningful parts of the description (e.g. `Office Depot` from `OFFICE DEPOT #1234 PURCHASE 04/15`)
2. **Find similar transactions** — searches posted transactions one key term at a time, from the most specific, first scoped to the known account and user, then to the known account, then across the book, and reads up to 15 from the first search that finds an account
3. **Choose the account** — when those transactions all used the same account, Bookbot suggests it. The same description can also be different operations: a `DEPOSIT` may be a client payment or an owner contribution. When they used different accounts, Bkper AI ranks them by comparing description, amount, date, day of month, hashtags, and properties, and Bookbot suggests the first

Accounts already on the transaction are kept. Bookbot only fills the sides that are missing, and when it re-checks a draft it never suggests again the account you corrected.

When every past transaction of the chosen account shares the same custom property (for example, a consistent `category` or `project` code), Bookbot copies that property onto the draft; it needs at least two such transactions. It only fills missing properties and never overwrites properties already present. You can prevent selected property keys from being copied with `agent_excluded_properties`.

## Re-checking drafts after a correction

When you correct an account that Bookbot suggested on a posted transaction, Bookbot re-runs discovery on the pending drafts in the book that received the same suggestion — one correction can fix many. The re-check considers up to 100 pending drafts and is skipped when the book's backlog has more than 50 items.

## AI allowance behavior

Discovery uses Bkper AI twice: Gemini Flash Lite, with minimal reasoning, picks out the key terms of a description, and Jev chooses among the accounts found in your posted transactions. Inference runs with the allowance of the signed-in user, or of the installation principal for event-driven re-checks, and is attributed to Bookbot. For Business and Professional subscriptions, the Bkper AI allowance may be shared across the domain. The Bkper AI usage dashboard shows the usage attributed to Bookbot.

## Configuration

<details>
<summary><strong>Account, group, and book properties</strong></summary>

| Property | Description |
|---|---|
| `agent_excluded_properties` | Comma- or whitespace-separated property keys that Bookbot never copies from historical transactions, for example `"trade_date, settlement_date"`. The effective value is resolved from the account, then the first matching account group, then the book; the first non-empty value wins. Matching is case-insensitive and exact. |

Bookbot no longer reads `bookbot_discovery_examples` or `agent_discovery_examples`: it compares whole transactions instead of tuning the key terms.

</details>

<details>
<summary><strong>Events handled</strong></summary>

| Event | Behavior |
|---|---|
| `TRANSACTION_POSTED` | If an account that Bookbot suggested was corrected, re-runs discovery on pending drafts that received the same suggestion |
| `TRANSACTION_UPDATED` | Same as `TRANSACTION_POSTED` |

</details>

<details>
<summary><strong>Transaction metadata</strong></summary>

Bookbot's suggestions are recorded on drafts as internal properties (suffixed with `_`) used for traceability and re-checks:

| Property | Description |
|---|---|
| `bookbot_credit_account_id_` | ID of the suggested credit account |
| `bookbot_debit_account_id_` | ID of the suggested debit account |
| `bookbot_confidence_` | Bkper AI's confidence when it ranked several accounts, such as `0.93`; `1.00` when similar transactions all used the same account |
| `bookbot_discovered_properties_` | Keys of the properties copied from history |

Drafts from before November 2026 carry these as `agent_credit_account_id_`, `agent_debit_account_id_`, and `agent_discovered_properties_`; Bookbot still reads them and renames them when it updates the draft. Bookbot no longer records the matched key term: when it fills an account, it removes `bookbot_description_part_` or `agent_description_part_` from the draft.

</details>

## API access

<details>
<summary><strong>Endpoints and examples</strong></summary>

Apps, scripts, and agents can ask Bookbot for accounts through the public API.

```text
Production: https://bookbot.bkper.app
Preview:    https://bookbot-preview.bkper.app
OpenAPI:    https://bookbot.bkper.app/openapi.json
```

All requests require a Bkper OAuth bearer token for a user with view access to every target book; no installation is required. The API reads your book but never writes to it: recording the suggested drafts is up to the caller.

| Operation | Route | Effect |
|---|---|---|
| Discover one transaction | `POST /api/v1/discovery` | Returns the transaction with suggested accounts and properties, without changing the book |
| Discover several transactions | `POST /api/v1/discovery/batch` | Same as above for several items, processed in order |

Each item names the target book and a draft transaction, and can include the source account to enable property copying. Each result has an outcome: `changed`, `no_change`, `no_match`, or `error`.

Minimal discovery example:

```bash
# Run `bkper auth login` first if needed
TOKEN="$(bkper auth token)"

curl -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "itemId": "1",
    "bookId": "<book-id>",
    "transaction": { "description": "Monthly rent", "creditAccount": { "id": "<account-id>" } }
  }' \
  https://bookbot.bkper.app/api/v1/discovery
```

Agents and scripts using the Bkper CLI can send the same request as the signed-in user with `bkper app api request bookbot /api/v1/discovery -d '<json>'`.

See the [OpenAPI specification](https://bookbot.bkper.app/openapi.json) for complete request and response schemas.

</details>

## Learn more

- [Recording transactions](https://bkper.com/docs/guides/using-bkper/record-guide) — how to record and manage transactions in Bkper
