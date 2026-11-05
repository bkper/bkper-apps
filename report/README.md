# Report

Type what you want to know about your Book and get a financial report instantly.

## What it does

Report reads your Book's balances and turns a short request, written in any language, into a clear report. It never changes your Book.

## How to use it

Open a Book in Bkper and choose **Report** from the Book menu.

## API access

This app exposes an authenticated API for scripts, integrations, and agents.

```txt
Production: https://report.bkper.app
Preview:    https://report-preview.bkper.app
```

OpenAPI specifications:

```txt
Production: https://report.bkper.app/openapi.json
Preview:    https://report-preview.bkper.app/openapi.json
```

Call API routes with a Bkper OAuth bearer token:

```bash
BKPER_TOKEN="$(bkper auth token)"

curl \
  -H "Authorization: Bearer ${BKPER_TOKEN}" \
  "https://report.bkper.app/api/v1/ping"
```

## Development

The app uses [Web Awesome Pro](https://webawesome.com), installed from `npm.webawesome.com`. Each developer needs their own Web Awesome Pro token: export it as `WA_TOKEN` before installing. The committed `.npmrc` only reads that variable; never commit the token.

```bash
export WA_TOKEN=<your Web Awesome Pro token>
npm install
```

Without `WA_TOKEN`, `npm install` fails with `E401` from the Web Awesome registry.

## Learn more

- [Bkper Help Center](https://bkper.com/docs)
