# Cloudflare Migration Plan

Migrating the Inventory Bot from Google Apps Script (GAS) + Google Cloud Functions to the Bkper Platform (Cloudflare Workers for Platforms). The migration is done in phases — web handler first, events handler second — without touching the running production system at any point.

---

## Current Architecture

| Layer | Technology | Location |
|-------|------------|----------|
| Menu (web handler) | Google Apps Script | `menu/server/` + `menu/client/` |
| Events handler | Google Cloud Functions | `events/` |
| App registration | `bkper.yaml` | root |

---

## Target Architecture

A new sibling project `inventory-bot-cloudflare/` is scaffolded as a standalone Bkper Platform app, developed independently. It shares the same `id: inventory-bot` app registration but is never promoted to production until explicitly cut over.

```
bkper-apps/
├── inventory-bot/                  ← existing project, never touched
│   ├── bkper.yaml
│   ├── events/                     ← Cloud Functions (active)
│   └── menu/                       ← GAS (active)
└── inventory-bot-cloudflare/       ← new project
    ├── bkper.yaml                  ← id: inventory-bot, same app registration
    ├── packages/
    │   ├── shared/                 ← shared types and constants
    │   ├── web/
    │   │   ├── client/             ← Vite + Lit + @bkper/web-auth (Phase 1)
    │   │   └── server/             ← Hono on Cloudflare Workers   (Phase 1)
    │   └── events/                 ← Cloudflare Workers webhook    (Phase 2)
    └── docs/
```

---

## GAS Coupling Points to Replace

Every GAS-specific API used by the current menu and its exact replacement:

| GAS API | Used For | Replacement |
|---------|----------|-------------|
| `google.script.run.xxx()` | Client → Server RPC | `fetch('/api/xxx')` REST calls |
| `google.script.url.getLocation()` | Read URL query params | `new URL(window.location.href).searchParams` |
| `HtmlService.createTemplateFromFile()` | Server-side HTML rendering | Hono serves Vite-built static page |
| `BkperApp` (GAS SDK) | All Bkper API calls | `bkper-js` |
| `PropertiesService.getScriptProperties()` | Read `API_KEY` secret | `c.env` (Cloudflare Workers binding) |
| `Utilities.formatDate()` | Date formatting | Standard JS `Intl.DateTimeFormat` |
| `<?!= book.name ?>` | Inject server data into HTML | Client fetches `/api/context-params` on load |
| `namespace` pattern | Code organisation | ES modules (`export function`) |

---

## Phase 1 — Web Handler Migration

### Tasks (recommended order)

#### Task 1 — Scaffold `inventory-bot-cloudflare` ✅

Run from the parent directory:

```bash
cd /Users/brunocoelho/Desktop/DEVELOPMENT/bkper/bkper-apps
bkper app init inventory-bot-cloudflare
```

#### Task 2 — Post-Init `bkper.yaml` Adjustments

| Field | Init Default | After Adjustment | Reason |
|-------|-------------|-----------------|--------|
| `id` | `inventory-bot-cloudflare` | `inventory-bot` | Same app registration — one app, one id |
| `menuUrl` | Cloudflare URL | GAS URL (unchanged from existing) | Production users keep using GAS throughout development |
| `menuUrlDev` | `http://localhost:8787/...` | `http://localhost:8787?bookId=${book.id}&accountId=${account.id}&groupId=${group.id}` | Developer sees local Cloudflare Worker when clicking menu |
| `menuPopupWidth` | _(not in template)_ | `600` | Match existing |
| `menuPopupHeight` | _(not in template)_ | `600` | Match existing |
| `webhookUrl` | Cloudflare events URL | `https://us-central1-inventory-bot-405017.cloudfunctions.net/prodGen2` | Production events stay on Cloud Functions — untouched |
| `name`, `description`, `logoUrl`, etc. | template placeholders | copied from existing `bkper.yaml` | Consistent app identity |
| `repoUrl` | template placeholder | `...inventory-bot-cloudflare` | Points to new directory |
| `deployment.web` | pre-set by template | kept as-is | Correct for Cloudflare Workers |
| `deployment.events` | pre-set by template | kept as-is | Ready for Phase 2 |

#### Task 3 — Port business logic to `bkper-js`

Migrate these files from the GAS SDK (`BkperApp`) to `bkper-js`. Each becomes an ES module under `packages/shared/` or `packages/web/server/src/`:

- `BotService.ts`
- `BotViewService.ts`
- `CalculateCostOfSalesService.ts`
- `ResetCostOfSalesService.ts`
- `GoodAccount.ts`
- `Summary.ts`
- `constants.ts`
- `Types.ts`

Authentication in all server-side calls uses the OAuth token from the request header:

```ts
const bkper = new Bkper({
    oauthTokenProvider: async () => c.req.header('bkper-oauth-token'),
});
```

> **Risk:** Verify that `bkper-js` exposes every method these files use (e.g. `book.getBacklog()`, `transaction.getCreatedAt()`, `account.getGroups()`) before writing any new code. Gaps here are the highest-risk part of the migration.

#### Task 4 — Create Hono API endpoints

Replace the `google.script.run` function surface with REST routes on the Hono server:

| GAS Function | New Hono Route |
|---|---|
| `getContextParams(params)` | `GET /api/context-params?bookId=&accountId=&groupId=` |
| `getAccountsToCalculate(ctx)` | `GET /api/accounts?bookId=&accountId=&groupId=` |
| `validate(bookId)` | `POST /api/validate` |
| `calculateCostOfSales(ctx, toDate?)` | `POST /api/calculate` |
| `resetCostOfSales(ctx)` | `POST /api/reset` |

#### Task 5 — Rewrite the client

Replace `menu/client/src/BotViewScript.ts` with a standard Vite web client:

- Remove all `google.script.run.xxx()` calls → replace with `fetch('/api/xxx')`
- Remove `google.script.url.getLocation()` → replace with `new URL(window.location.href).searchParams`
- Add `@bkper/web-auth` (`BkperAuth`, `getAccessToken`) for authentication
- The HTML structure (`BotView.html`) stays largely the same — remove `<?!= book.name ?>` GAS template expressions; the client fetches that data from `/api/context-params` on load
- Vite handles bundling and asset serving

#### Task 6 — Test locally end-to-end

```bash
cd inventory-bot-cloudflare
bkper app dev --web
```

Open the menu from a real Bkper book (`menuUrlDev` routes to `localhost:8787`). Validate each API endpoint: context-params, accounts list, validate, calculate, reset.

#### Task 7 — Deploy and cut over

```bash
npm run build
bkper app sync
bkper app deploy
```

Then update `menuUrl` in `inventory-bot-cloudflare/bkper.yaml`:

```yaml
menuUrl: https://inventory-bot.bkper.app?bookId=${book.id}&accountId=${account.id}&groupId=${group.id}
```

Run `bkper app sync` once more. The GAS deployment remains intact as a fallback.

---

## Phase 2 — Events Handler Migration (Future)

Migrate the Cloud Functions events handler to the `packages/events/` Cloudflare Workers package already scaffolded in `inventory-bot-cloudflare/`. The existing `events/` logic in the original project is ported to `bkper-js` and the Hono event routing pattern. Cut over by updating `webhookUrl` in `bkper.yaml` and running `bkper app sync`.

---

## Safety Invariant (Phases 1 & 2)

Two `bkper.yaml` files share `id: inventory-bot`. This is safe because:

- `menuUrl` stays pointing to GAS in both files throughout Phase 1 development → production users are never affected
- `menuUrlDev` differs: existing project → GAS dev URL, new project → `localhost:8787`
- `webhookUrl` stays pointing to Cloud Functions in both files throughout Phase 1 → events handler is never affected
- Running `bkper app sync` from the new project only adds the `deployment` section — it does not exist in the existing project

### What stays frozen during development

| | Touched? |
|---|---|
| `inventory-bot/` existing project | ❌ Never |
| GAS deployment (`clasp push/deploy`) | ❌ Never |
| Cloud Functions events handler | ❌ Never (until Phase 2) |
| Production `menuUrl` | ❌ Until Task 7 cut-over |
| Production `webhookUrl` | ❌ Until Phase 2 cut-over |
