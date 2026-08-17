# Merge Duplicates

Merge Duplicates helps you find transaction rows that may represent the same real-world movement. It combines deterministic checks with Bkper AI, while keeping every merge under human control.

## How to use it

1. Open a Book, select an Account or Group if useful, and set the transaction query you want to review.
2. Choose **Merge Duplicates** from the Book menu.
3. Review the suggested pairs. Every suggestion starts accepted.
4. Choose **Not a duplicate** to move a pair to the collapsed Rejected section. Use **Undo** to restore it.
5. Choose **Analyze next 200** to append another page without losing your decisions.
6. Choose **Apply review**, verify the accepted and rejected counts, and confirm.

Accepted pairs are merged one at a time. Bkper creates a canonical transaction and trashes the two originals. A failed pair does not stop later pairs. Rejected pairs are saved as plain-text examples when your Book permission allows property updates.

Checked, trashed, and locked transactions are never suggested. The app never merges automatically.

## API access

Authenticated clients can use the same app workflow through:

```txt
Production: https://merge-duplicates.bkper.app
Preview:    https://merge-duplicates-preview.bkper.app
OpenAPI:    https://merge-duplicates.bkper.app/openapi.json
```

Example:

```bash
curl \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"bookId":"<book-id>","query":"","fingerprints":[]}' \
  https://merge-duplicates.bkper.app/api/v1/scan
```
