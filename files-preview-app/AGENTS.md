# Files Preview App

## Overview

A minimal Bkper app that previews book files directly in the browser.

## What this app does

Given a URL like `/books/{bookId}/files/{fileId}/{fileName}`:

1. The **server** (Hono on Cloudflare Workers) serves `index.html` for all `/books/*` routes (SPA fallback).
2. The **client** (vanilla TypeScript + bkper-js):
   - Authenticates via `@bkper/web-auth`
   - Parses `bookId`, `fileId`, and `fileName` from the URL path
   - Fetches the file via `book.getFile(fileId)` then `file.getContent()` (base64)
   - Decodes base64 into a Blob, creates a blob URL
   - Renders the file inline (image, PDF, text, or generic iframe)
   - Adds a floating **Download** button with the URL filename

## Architecture

```
packages/
└── web/
    ├── client/           # File preview UI
    │   ├── index.html
    │   ├── src/index.ts
    │   └── public/images/logo-light.svg
    │   └── public/images/logo-dark.svg
    └── server/           # SPA fallback for /books/* routes
        └── src/index.ts
```

There is **no events package**, **no shared package**, and **no KV usage**.

## Key patterns

- **Do not use `file.getUrl()`** — that URL points back to this app. We fetch raw base64 content via `file.getContent()` and render it as a blob URL.
- **No custom OAuth** — `@bkper/web-auth` handles everything.
- **No server-side API routes** — the server only does SPA fallback.

## Development

```bash
bun install
bun run dev
```

- Vite client: `http://localhost:5174`
- Miniflare worker: `http://localhost:8788`

## Build & Deploy

```bash
npm run build && bkper app sync && bkper app deploy
```

## Config

All app config lives in `bkper.yaml`. There are no secrets or environment variables.
