# Bkper CSV App

## Overview

Platform replacement for the archived Apps Script CSV app. It adds an **Export CSV** context-menu item to Bkper Books and exports the current transaction query to a CSV file.

## Scope

- Export-only.
- Read-only: the app never creates, updates, checks, unchecks, trashes, or imports transactions.
- Preserve the old app's default export behavior where practical:
  - semicolon delimiter
  - Book-formatted dates
  - Book-formatted values
  - `bkper_<timestamp>.csv` filename pattern

## Architecture

```txt
client/  — Lit UI, @bkper/web-auth, bkper-js, CSV generation/download
server/  — Minimal Worker serving health and static assets
```

There are no `/api/*` routes and no event handlers. The client calls Bkper directly using `@bkper/web-auth` and `bkper-js`.

## Local development

Ports are assigned in `/workspace/bkper-apps/AGENTS.md`:

- Vite client: `5176`
- Bkper app Worker: `8789`

```bash
bkper auth login
bun install
bun run dev
```

## Verification

```bash
bun test
bun run typecheck
bun run build
```

Do not run `bkper app sync`, `bkper app deploy`, or app installation commands without explicit confirmation.
