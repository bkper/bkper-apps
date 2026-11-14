# Extractor Bot — Platform App

## Status and safety

Read the responsibilities, events, properties and parse API below before changing behavior or ownership.

This directory is the Extractor Bot Platform app, started from the legacy Bookbot extraction automation. It is published, deployed to production and preview, and installed by Bkper wherever Bookbot is installed. It handles file, created, posted/updated (learning), deleted and audit events, and serves the read-only parse API. File-import and transaction-created handlers call Bookbot's discovery API; Extractor Bot has no local discovery or rediscovery. Extractor Bot is distinct from the managed conversational Bkper Agent.

- It is a standard Bkper Platform app (`extractor-bot`), deployed with `bkper app build` and `bkper app deploy`. Never use `wrangler deploy`.
- `bkper.yaml` here is the source of truth for the `extractor-bot` registration.
- `extractor-bot` replaces the retiring app ID `parser-bot`, which serves the same code frozen at the Git tag `parser-bot-final`. Its registration is synced only from `../parser-bot/` (a metadata shell) and is never deployed from this directory. `extractor-bot` subscribes to no events until the switch from `parser-bot`.
- Do not deploy, sync metadata, install, replay events, publish, or send real events without separate explicit approval. Before deploying, confirm the build log reports `Build complete` without errors.
- Event handlers and API routes use Platform authentication: `new Bkper()` with outbound-injected authorization. Never read `bkper-oauth-token`, `bkper-agent-id`, or `Authorization` headers.
- The README is Extractor Bot's public listing: reading documents, statements and descriptions into drafts, and learning from corrections.
- Keep README content public-facing; development information belongs here.
- Existing technical names stay unchanged. The app ID, directory, URLs, API path (`/api/v1/extract`) and properties say `extractor`; code names (`FileParserRouter`, `lookupParserUrl`, `parse`, …) still say parser.
- Every Bkper AI request, from events and the parse API alike, carries `bkper-ai-source: extractor-bot` (`BKPER_AI_SOURCE`). The Bkper AI usage dashboard groups usage by this label; Bookbot labels its own requests `bookbot`.
- Neither parser nor discovery should post transactions. Preserve explicit account sides, existing property behavior, legacy provenance, parser URL ownership, and target-Book access.
- Change only what the task needs. Do not silently implement future API or outage policy.
- Extractor Bot consumes Bookbot discovery through its API and has no local discovery code. Do not reintroduce it.

## Refactoring rules

- Goal: split the two apps into isolated business processes with the least code change possible. Current behavior works; don't break it.
- Don't rewrite, fix, rename, reformat, or clean up. Record defects or ideas for a separate, approved change.
- Move code verbatim, keeping names, comments, and order.
- Keep diffs small and easy to review: one focused step per commit.
- Before changing behavior that tests don't cover, add a short test of the current behavior. Existing tests change only mechanically.

## Rules

- Preserve Bkper's zero-sum model. Extractor Bot never posts transactions; unresolved results remain unposted drafts.
- AI suggests or extracts. Deterministic application code validates, merges, and controls financial writes.
- Reusable APIs return results without Book writes; Book reads and inference are allowed. Event adapters or explicitly authorized callers own persistence.
- API calls need authorization for every target Book, not app installation. Event automation requires installation.
- Hosting: one standard Bkper Platform app serving `/events`, `/api/v1/*`, and `/openapi.json`. Event and API code use `new Bkper()` with Platform outbound authentication.
- Bookbot discovery: Extractor Bot calls Bookbot with a plain `fetch`; Platform outbound delegates user or event context without exposing credentials (app chain, loop and hop limits enforced by Dispatch). Both Extractor Bot environments call only `https://bookbot.bkper.app/api/v1/*` (switched from `bookbot-preview` on 2026-11-04, after production Bookbot took over all Bookbot events; the legacy Bookbot Worker is only a rollback target and is never called). The address is one constant. Bookbot's discovery API contract is in [Bookbot's AGENTS.md](../bookbot/AGENTS.md).
- Preserve explicitly supplied accounts and properties, existing `agent_*` properties, and legacy provenance, including Bookbot's credit and debit Account suggestions (`bookbot_*`, earlier `agent_*`) read by statement learning.
- Do not log credentials, document content, transaction descriptions, or private Book data. Log counts, lengths, property names and field names instead of values; never log a customer parser URL (it may carry credentials). `test/privacy-logs.test.ts` guards this.

## Responsibilities

Extractor Bot owns:

- File classification and transaction extraction for one transaction, multiple transactions, and file metadata.
- Amount and date extraction from descriptions.
- Imported draft recording, attachments, target Books, and `extractor_transactions_summary`.
- Extraction provenance, correction learning, statement flags, and audit processing.
- Coordinating transaction-created events: extract, call Bookbot discovery, then perform the single draft update. Bookbot does not separately enrich the same event.

Extractor Bot does not implement discovery. Its duplicated discovery code was removed; discovery runs only in Bookbot.

Extractor Bot does not call external parsers. Files with parser URLs belong to another app (see the ownership rule below).

## External parser ownership

Every file and attachment has one owner. Another app owns those with parser URLs (`extractor_url_*`, then `agent_parser_url_*`) and processes exactly the events Extractor Bot skips. Extractor Bot keeps only the lookup (`PromptLookupService.lookupParserUrl`) to step aside, and never calls a parser URL, from events or the parse API.

- `FILE_CREATED`: after the attachment-upload and summary checks, `FileParserRouter.hasParserUrl` looks up `transactions`, `transaction` (not for CSV) and `file`, with the Account and Group from prompt resolution. Any URL: `{ result: false }`, logging `Parser URL configured; extraction belongs to another app` (never the URL or names). No AI, discovery or writes.
- `TRANSACTION_CREATED` with an attachment whose file has `upload_method=attachment`: right after prompt lookup, `transaction` and `file` lookups with `{ book, transaction, file, account, group }` from prompt resolution. Any URL: the same skip, before any AI or discovery.
- `TRANSACTION_CREATED` without an attachment, carrying `extractor_file_id_` (or `agent_file_id_`): `{ result: false }`. These are drafts recorded from a file by another app. Bkper sends an app's events to every other installed app, so discovering them would race with that app's own writes.
- Learning already skips Accounts and Groups with a parser URL.
- Do not change the ownership rule or the lookup without coordinating with the app that owns parser URLs: it keeps a copy of the same lookup and the same cases (`test/events/external-parser-ownership.test.ts`).

## Events

| Event | Behavior to preserve | Writes |
| --- | --- | --- |
| `FILE_CREATED` | Skip attachment uploads and files with `extractor_transactions_summary` or `transactions_summary`; skip files with a parser URL; parse with AI; discover per target Book; create drafts sequentially by target Book; record file metadata and summary. | Drafts in any target Book, file update |
| `TRANSACTION_CREATED` with attachment | Use the first attachment; require `upload_method=attachment`; skip when a parser URL is configured; concurrently extract the transaction (only when amount or description is missing) and file metadata (only when `extractor_prompt_file` is configured); fill missing fields, falling back to description extraction for amount and date; set the amount-side Account; discover; record `extractor_extracted_` when extracted values apply. | Transaction update, then file update |
| `TRANSACTION_CREATED` without attachment | Skip drafts with `extractor_file_id_` or `agent_file_id_`; discover first; extract amount only when missing and date only when `auto_filled_date_` exists; update once. | Transaction update |
| `TRANSACTION_POSTED` / `TRANSACTION_UPDATED` | Posted transactions only: invoice learning and statement flagging. Bookbot also subscribes for rediscovery. | Prompt and flag updates |
| `TRANSACTION_DELETED` | Flag statement learning from the event payload. | Flag update |
| `BOOK_AUDITED` | Improve the most recently flagged statement prompt. | Prompt update and flag clear |

Every row except transaction-created without an attachment looks up prompts or parser URLs, which can also persist the lazy legacy prompt migration on Accounts and Groups.

## Properties

| Properties | Role |
| --- | --- |
| `extractor_prompt_transaction`, `extractor_prompt_transactions`, `extractor_prompt_file` | Extraction prompts. Earlier `agent_parser_*` prompts and legacy `agent_prompt*` properties migrate lazily during lookup. |
| `extractor_url_*`, then `agent_parser_url_*` | Parser URLs of the app that owns those files. Read only to step aside and to skip learning; never called, never rewritten. Legacy `agent_parser_url` is intentionally unsupported. |
| `upload_method`, `account_id`, `group_id` (and legacy `upload_method_`, `account_id_`, `group_id_`), `auto_filled_date_` | Source and context inputs read by extraction. |
| `extractor_extracted_`, `extractor_file_id_`, `extractor_prompt_improve_`, `extractor_transactions_summary`, extracted transaction and file properties | Extraction provenance, learning state, and recording receipts. Earlier names (`agent_extracted_`, `agent_file_id_`, `agent_prompt_improve_`, `transactions_summary`) are read after the new ones; transactions and files keep them, and flag writes delete them on Accounts and Groups. |
| `parsed_account_name_` | Set by Bkper when a created transaction's description names one Account. Prompt and parser-URL lookup reads it; Bookbot discovery uses it and removes it locally. |
| `bookbot_credit_account_id_`, `bookbot_debit_account_id_` (earlier `agent_credit_account_id_`, `agent_debit_account_id_`) | Bookbot provenance read by statement learning. |
| `agent_excluded_properties`, legacy `agent_prompt_skip` | Exclusions shared with Bookbot. Both read; neither writes. |

Property names: read the new name first, then the old one (`getProperty(NEW, OLD)`), and write only the new name. When writing a prompt or flag on an Account or Group, delete its old name in the same `update()`. Never rewrite parser URLs, transactions or files to rename keys. Keys starting with `agent_`, `extractor_` or `bookbot_` (`APP_PROPERTY_PREFIXES`) are app-owned: never learned from, and dropped from extracted file properties. New keys have at most 30 characters; `test/property-names.test.ts` checks it. Statement learning finds a file's drafts with one query per file ID name.

## Parse API

- Follow Bookbot's shared conventions for versioned routes, OpenAPI, canonical Bkper payloads, errors, and target-Book authorization.
- The endpoint is `POST /api/v1/extract`. `POST /api/v1/parse` is its earlier name: the same handler, kept working for existing callers and left out of `/openapi.json`. Remove it only when logs show no callers. For files, reuse `FileParserRouter`'s existing automatic detection and routing; callers do not select a parser. One statement can return multiple transactions. Requests containing multiple input files and a separate `/batch` route are deferred.
- The request is `{ bookId, file?, transaction? }`, using canonical `bkper.File` and `bkper.Transaction` payloads and requiring at least one. A file uses existing automatic parsing; a transaction supplies description or attachment context; both together use the supplied transaction context for file extraction. No parser-selection field is required.
- The API never calls parser URLs: it extracts with AI, also where a parser URL is configured. File requests without a transaction return `kind` (`transaction` or `transactions`, the router's result), so a caller can record API results as an import would.
- The initial API exposes raw extraction only. Composed parse-and-discover is deferred to keep the API small; callers can use Bookbot's discovery API separately.
- The response is `{ transactions: [{ bookId, transaction }], fileProperties?, kind?, outcome, error? }`. Transactions are canonical `bkper.Transaction` payloads; the wrapper preserves cross-Book targets. Outcomes are `parsed`, `empty`, or `error`; errors use Bookbot's `{ code, message }` shape.
- API authorization follows Bookbot: Platform bearer authentication and outbound authorization; `VIEWER`, `POSTER`, `EDITOR`, or `OWNER` access on every target Book; no installation requirement. Caller-supplied identities never select permissions or AI allowance.
- Read-only results never contain native transaction IDs or claim drafts were recorded. Summaries are written by the recording adapter after successful writes.
- Read-only parsing must not run the legacy prompt migration. Inject a non-persisting migration into `PromptLookupService`.
- Existing parts are reused unchanged: `FileParserRouter` already parses without recording drafts, `ExtractorAmount` and `ExtractorDate` already extract description fields, and learning services are already separate from event handling.

The initial route, request/result/error shapes, and shared authentication boundary are agreed. Legacy event authentication and behavior remain unchanged.

## Known current behavior

- Prompt and parser-URL lookup can persist migrated prompt properties.
- An `account_name` that is not in the target Book records that row without the Account and logs a warning; the rest of the import continues. `book.getAccount`, `getFile` and `getGroup` raise a 404 `BkperError` for a missing resource instead of returning undefined (bkper-js 2.37 to 2.45). Lookups by an extracted name or a caller-supplied ID go through `findAccount`, `findFile` and `findGroup` in `src/utils/lookup-utils.ts`, so a missing resource is "not found" (no Account for an import row, `INVALID_CONTEXT` in the parse API) rather than a failure or `FORBIDDEN`.
- Multi-Book imports are not atomic: drafts are created per target Book in sequence; if a later Book fails, earlier drafts remain and no summary or file update is written.
- The posted/updated handler runs invoice learning and statement flagging; rediscovery was removed and belongs to Bookbot.
- The attachment path retains its own file-metadata filter, moved verbatim into `AttachmentExtractionService`. Unlike the import path's `filterFileProperties`, it does not drop the earlier `transactions_summary` (both drop `extractor_*`). Do not merge the two.

## Local verification

```bash
bun run api               # Generate client types and OpenAPI snapshot after contract changes (also Bookbot client types)
bun run api:check         # Verify contract freshness
bun run typecheck
bun run typecheck:tests
bun run build             # Wrangler dry-run only
bun run test:unit         # Clears live AI variables; integration cases skip
bun run test              # All of the above
```

Event handlers call Bookbot's discovery API through `src/services/BookbotDiscoveryClient.ts`. When Bookbot's contract changes, copy `bookbot/test/api/openapi.snapshot.json` to `src/clients/bookbot/openapi.json` and run `bun run api`. Local runs cannot call Bookbot (local outbound authorizes only the Bkper API and Bkper AI); tests use the doubles in `test/helpers/bookbot-discovery.ts`.

`eval/system-one/` compares Clairic (Open System One), as first asked and with the bot's context, with the bot's current Gemini extraction on synthetic invoices and receipts; it is not part of the app bundle and reuses `ExtractorInvoice` unchanged. `bun run eval:system-one --check` confirms `RESULTS.md` matches the recorded responses offline. `--live`, `--live-clairic` and `--live-new` make paid calls and need separate approval.

Existing tests and fixtures remain unchanged. Focused API tests cover read-only behavior, canonical payloads, authorization, error handling, and that parser URLs are never called. For refactoring, follow the rules above. Run `bun run test` after each step.

## Check and deploy

There is no CI workflow for this app. Run these from this directory: check locally, then deploy by hand with separate approval for each live step.

```bash
bun install --frozen-lockfile --ignore-scripts
bun run test              # Build, contract freshness, typechecks and unit tests
bkper app build           # Platform bundle in dist/; the log must say "Build complete" with no ERROR
bkper app deploy --preview   # extractor-bot-preview.bkper.app
bkper app deploy             # extractor-bot.bkper.app (production)
bkper app status
```

- Deploy and sync need a clean tree whose commit is pushed to `origin/main`. `bkper app deploy` uploads the existing `dist/`, so build from that commit first.
- `bkper app sync` replaces the live `extractor-bot` registration (events, properties, file patterns, webhooks, README) with this directory's `bkper.yaml` and README. Run it only when they changed.
- Never run `wrangler deploy`; `wrangler.jsonc` is for local development and the dry-run build only.
- After a deploy, check that `https://extractor-bot.bkper.app/openapi.json` matches `test/api/openapi.snapshot.json` and read the newest requests with `bkper app logs extractor-bot --events`.

Worker/inspector ports: 8808 / 9608. No UI/client port is needed. Local serving and event delivery are not part of baseline verification.

## Code conventions

- Strict TypeScript; use canonical Bkper types, never `as any` in new code.
- Imports at the top, external libraries first, internal paths with `.js` extensions.
- Four-space indentation, single quotes, semicolons.
- Prefer resource `.json()`; never manually map SDK getters to recreate API objects.
- Keep business behavior, connectors, transport, and persistence separate without forwarding-only layers.
- Model resources and From/To movements; deterministic application code controls financial writes.
- Read the Bkper core concepts and app quality/security references before changes; review changed code against quality guidance before completion.

## Source and redistribution

The source/fixture owner confirmed redistribution rights and that document fixtures are synthetic. The monorepo MIT license covers Bkper-owned source; dependencies retain their own licenses. No private repository history, credentials, operational rollout plan, or generated build output belongs in this public source snapshot. Re-review the final tree and dependency notices before any publication.

Extractor Bot uses its own ignored `node_modules` installation (`bun install --frozen-lockfile --ignore-scripts`). Keep `bun.lock` committed and in sync with `package.json`.
