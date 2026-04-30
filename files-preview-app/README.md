# Files Preview App

A minimal Bkper app that lets you preview any file attached to a book directly in the browser.

## What it does

Open a URL like:

```
https://files.bkper.app/books/{bookId}/files/{fileId}/{fileName}
```

The app authenticates the user, fetches the file from Bkper, and renders it inline:

- **Images** — centered preview with dark background
- **PDFs** — native browser embed
- **Text / JSON** — iframe preview
- **Anything else** — browser handles inline display or download

A floating **Download** button uses the URL filename so browsers save the file with the correct name.

## Local Development

```bash
bun install
bun run dev
```

- Client dev server: `http://localhost:5174`
- Worker runtime: `http://localhost:8788`

Test with a real file URL:

```
http://localhost:5174/books/{bookId}/files/{fileId}/{fileName}
```

## Build & Deploy

```bash
npm run build && bkper app sync && bkper app deploy
```

Live at `https://files.bkper.app`.

## Project Structure

```
packages/
└── web/
    ├── client/           # File preview UI (Vite, vanilla TS, bkper-js)
    │   ├── index.html
    │   ├── src/index.ts
    │   └── public/images/logo-light.svg
    │   └── public/images/logo-dark.svg
    └── server/           # SPA fallback for /books/* routes (Hono)
        └── src/index.ts
```

## Tech Stack

- [Bkper Platform](https://bkper.com/docs/build/apps/overview.md) — hosting, auth, deployment
- [bkper-js](https://www.npmjs.com/package/bkper-js) — Bkper SDK
- [@bkper/web-auth](https://www.npmjs.com/package/@bkper/web-auth) — pre-configured OAuth
- [Vite](https://vitejs.dev/) — client build
- [Hono](https://hono.dev/) — web server

## Learn More

- [Bkper Developer Docs](https://bkper.com/docs)
- [Bkper CLI](https://www.npmjs.com/package/bkper)
