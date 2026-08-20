# Merge Duplicates

Merge Duplicates helps you find transaction rows that may represent the same real-world movement. It combines deterministic checks with Bkper AI, while keeping every merge under human control.

## How to use it

1. Open a Book, select an Account or Group if useful, and set the transaction query you want to review.
2. Choose **Merge Duplicates** from the Book menu.
3. Review the suggested pairs. Every new suggestion starts selected.
4. Unselect pairs that are not duplicates. Select them again to restore them.
5. Choose **Look for more** to scan up to 200 more transactions. The app refreshes its cumulative suggestions and preserves your decisions for unchanged pairs.
6. Choose **Apply**, verify the selected and unselected counts, and confirm.

Selected pairs are merged one at a time. Bkper creates a canonical transaction and schedules the two originals to be moved to Trash. A failed pair does not stop later pairs.

When you apply the review, unselected pairs are saved as plain-text examples on the selected Account, Group, or Book. Owner and Editor collaborators can save the latest 40 examples. Post collaborators can merge, but their examples are not saved. Viewers cannot scan or merge.

Checked, trashed, and locked transactions are never suggested. The app never merges automatically.

## API access

Authenticated clients can use the same app workflow. See the [OpenAPI specification](https://merge-duplicates.bkper.app/openapi.json) for the complete contract.

Example:

```bash
curl \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"bookId":"<book-id>","query":"","fingerprints":[]}' \
  https://merge-duplicates.bkper.app/api/v1/scan
```
