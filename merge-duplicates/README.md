# Merge Duplicates

Merge Duplicates helps you find transaction rows that may represent the same real-world movement. It combines deterministic checks with Bkper AI, while keeping every merge under human control.

## How to use it

1. Open a Book, select an Account or Group if useful, and set the transaction query you want to review.
2. Choose **Merge Duplicates** from the Book menu.
3. Review the suggested pairs. Every new suggestion starts selected.
4. Unselect pairs that are not duplicates. Select them again to restore them.
5. Choose **Look for more** to load up to 200 more transactions. The browser resubmits the cumulative set (up to 1,000 transactions), refreshes the suggestions, and preserves your decisions for unchanged pairs.
6. Choose **Apply**, verify the selected and unselected counts, and confirm.

Selected pairs are merged one at a time. Bkper creates a canonical transaction and schedules the two originals to be moved to Trash. A failed pair does not stop later pairs.

When you apply the review, unselected pairs are saved as plain-text examples on the selected Account, Group, or Book. Owner and Editor collaborators can retain the latest 50 examples within the property budget. Post collaborators can merge, but their examples are not saved. Viewers cannot list transactions, analyze, or merge.

Checked, trashed, and locked transactions are never suggested. The app never merges automatically.

## API access

Authenticated clients can use the same app workflow. See the [OpenAPI specification](https://merge-duplicates.bkper.app/openapi.json) for the complete contract.

Example:

```bash
# Run `bkper auth login` first if needed
TOKEN="$(bkper auth token)"

curl \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "bookId": "<book-id>",
    "transactions": [
      {
        "id": "<transaction-id-1>",
        "date": "2026-06-10",
        "amount": "12.50",
        "description": "Corner Cafe",
        "posted": true,
        "creditAccount": { "id": "<account-id>", "name": "Card" }
      },
      {
        "id": "<transaction-id-2>",
        "date": "2026-06-11",
        "amount": "12.50",
        "description": "CORNER CAFE",
        "posted": true,
        "creditAccount": { "id": "<account-id>", "name": "Card" }
      }
    ]
  }' \
  https://merge-duplicates.bkper.app/api/v1/analyze
```
