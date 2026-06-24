# Files Preview

Preview any file attached to your Bkper books directly in the browser — no downloads required.

## What it does

This app renders files in your browser from a direct URL. When an external integration (like the Google Sheets add-on or another app) links to a file, this app fetches it and displays it inline:

- **Images** — centered preview with a dark background
- **PDFs** — native browser viewer
- **Text & JSON** — readable inline display
- **Other files** — your browser handles preview or download automatically

A floating **Download** button lets you save the file with its original name whenever you need a local copy.

## Supported file types

The app works with any file you've attached to a Bkper book, including:

| Type | Preview behavior |
|------|-----------------|
| PNG, JPG, GIF, SVG, WebP | Inline image viewer |
| PDF | Native browser embed |
| TXT, CSV, JSON, XML | Readable text display |
| Other formats | Browser-native preview or download |

## How to use it

Files Preview opens when you follow a file link from an external Bkper integration. The URL looks like:

```text
https://files.bkper.app/books/{bookId}/files/{fileId}/{fileName}
```

If you're not signed in, you'll be prompted to authenticate first — then the file renders immediately.

No setup or configuration needed. It just works.
