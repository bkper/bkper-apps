# Parser Bot — Local Staging

## Status and safety

Read the responsibilities, events, properties and parse API below before changing behavior or ownership.

This directory is the Parser Bot Platform app, started from the legacy Bookbot extraction automation. It is registered (unpublished); its preview is deployed and installed only on a dedicated test Book. The read-only parsing API is implemented. File-import and transaction-created handlers call Bookbot's discovery API (verified on preview); local discovery and rediscovery were removed. Since the 2026-11-05 handover, Parser Bot handles file, created, posted/updated (learning), deleted and audit events. Bookbot is distinct from the managed conversational Bkper Agent.

- It is a standard Bkper Platform app (`parser-bot`), deployed with `bkper app build` and `bkper app deploy --preview`. Never use `wrangler deploy`. Production is not deployed.
- Do not deploy, sync metadata, install, replay events, publish, or send real events without separate explicit approval. Never install Parser Bot in a Book where the legacy Bookbot is installed. Before deploying, confirm the build log reports `Build complete` without errors.
- Event handlers and API routes use Platform authentication: `new Bkper()` with outbound-injected authorization. Never read `bkper-oauth-token`, `bkper-agent-id`, or `Authorization` headers.
- The snapshot's README describes the legacy Bookbot behavior. It is not a Parser Bot product listing.
- Keep README content public-facing; development information belongs here.
- Existing technical names and `agent_*` properties stay unchanged.
- Neither parser nor discovery should post transactions. Preserve explicit account sides, existing property behavior, legacy provenance, parser URL ownership, and target-Book access.
- Change only what the task needs. Do not silently implement future API or outage policy.
- Parser Bot consumes Bookbot discovery through its API and has no local discovery code. Do not reintroduce it.

## Refactoring rules

- Goal: split the two apps into isolated business processes with the least code change possible. Current behavior works; don't break it.
- Don't rewrite, fix, rename, reformat, or clean up. Record defects or ideas for a separate, approved change.
- Move code verbatim, keeping names, comments, and order.
- Keep diffs small and easy to review: one focused step per commit.
- Before changing behavior that tests don't cover, add a short test of the current behavior. Existing tests change only mechanically.

## Shared rules with Bookbot

The shared rules in [Bookbot's AGENTS.md](../bookbot/AGENTS.md) apply here too: no posting, deterministic financial writes, read-only APIs, per-Book authorization, Platform hosting and the Bookbot address, preserved properties and provenance, no private data in logs.

## Responsibilities

Parser Bot owns:

- File classification and transaction extraction for one transaction, multiple transactions, and file metadata.
- Amount and date extraction from descriptions.
- External parser connectors, preserving their request contract. Top-level group context is sent only when the parser URL is configured on that group.
- Imported draft recording, attachments, target Books, and `transactions_summary`.
- Extraction provenance, correction learning, statement flags, and audit processing.
- Coordinating transaction-created events: extract, call Bookbot discovery, then perform the single draft update. Bookbot does not separately enrich the same event.

Parser Bot does not implement discovery. Its duplicated discovery code was removed; discovery runs only in Bookbot.

## Events

| Event | Behavior to preserve | Writes |
| --- | --- | --- |
| `FILE_CREATED` | Skip attachment uploads and files with `transactions_summary`; parse; discover per target Book; create drafts sequentially by target Book; record file metadata and summary. | Drafts in any target Book, file update |
| `TRANSACTION_CREATED` with attachment | Use the first attachment; require `upload_method=attachment`; concurrently extract the transaction (only when amount or description is missing) and file metadata (only when a file parser URL or `agent_parser_file` is configured); fill missing fields, falling back to description extraction for amount and date; set the amount-side Account; discover; record `agent_extracted_` when extracted values apply. | Transaction update, then file update |
| `TRANSACTION_CREATED` without attachment | Discover first; extract amount only when missing and date only when `auto_filled_date_` exists; update once. | Transaction update |
| `TRANSACTION_POSTED` / `TRANSACTION_UPDATED` | Posted transactions only: invoice learning and statement flagging. Bookbot also subscribes for rediscovery. | Prompt and flag updates |
| `TRANSACTION_DELETED` | Flag statement learning from the event payload. | Flag update |
| `BOOK_AUDITED` | Improve the most recently flagged statement prompt. | Prompt update and flag clear |

Every row except transaction-created without an attachment looks up prompts or parser URLs, which can also persist the lazy legacy prompt migration on Accounts and Groups.

## Properties

| Properties | Role |
| --- | --- |
| `agent_parser_transaction`, `agent_parser_transactions`, `agent_parser_file`, `agent_parser_url_*` | Parser configuration. Legacy `agent_prompt*` properties migrate lazily during lookup; legacy `agent_parser_url` is intentionally unsupported. |
| `upload_method`, `account_id`, `group_id` (and legacy `upload_method_`, `account_id_`, `group_id_`), `auto_filled_date_` | Source and context inputs read by extraction. |
| `agent_extracted_`, `agent_file_id_`, `agent_prompt_improve_`, `transactions_summary`, extracted transaction and file properties | Extraction provenance, learning state, and recording receipts. |
| `parsed_account_name_` | Set by Bkper when a created transaction's description names one Account. Prompt and parser-URL lookup reads it; Bookbot discovery uses it and removes it locally. |
| `agent_credit_account_id_`, `agent_debit_account_id_` | Bookbot provenance read by statement learning. |
| `agent_excluded_properties`, legacy `agent_prompt_skip` | Exclusions shared with Bookbot. Both read; neither writes. |

## Parse API

- Follow Bookbot's shared conventions for versioned routes, OpenAPI, canonical Bkper payloads, errors, and target-Book authorization.
- The initial endpoint is `POST /api/v1/parse`. For files, reuse `FileParserRouter`'s existing automatic detection and routing; callers do not select a parser. One statement can return multiple transactions. Requests containing multiple input files and a separate `/batch` route are deferred.
- The request is `{ bookId, file?, transaction? }`, using canonical `bkper.File` and `bkper.Transaction` payloads and requiring at least one. A file uses existing automatic parsing; a transaction supplies description or attachment context; both together use the supplied transaction context for file extraction. No parser-selection field is required.
- The initial API exposes raw extraction only. Composed parse-and-discover is deferred to keep the API small; callers can use Bookbot's discovery API separately.
- The response is `{ transactions: [{ bookId, transaction }], fileProperties?, outcome, error? }`. Transactions are canonical `bkper.Transaction` payloads; the wrapper preserves cross-Book targets. Outcomes are `parsed`, `empty`, or `error`; errors use Bookbot's `{ code, message }` shape.
- API authorization follows Bookbot: Platform bearer authentication and outbound authorization; `VIEWER`, `POSTER`, `EDITOR`, or `OWNER` access on every target Book; no installation requirement. Caller-supplied identities never select permissions or AI allowance.
- Read-only results never contain native transaction IDs or claim drafts were recorded. Summaries are written by the recording adapter after successful writes.
- Read-only parsing must not run the legacy prompt migration. Inject a non-persisting migration into `PromptLookupService`.
- Existing parts are reused unchanged: `FileParserRouter` already parses without recording drafts, `ExtractorAmount` and `ExtractorDate` already extract description fields, and learning services are already separate from event handling.

The initial route, request/result/error shapes, and shared authentication boundary are agreed. Legacy event authentication and behavior remain unchanged.

## Known current behavior

- Prompt and parser-URL lookup can persist migrated prompt properties.
- File imports fail entirely when an external parser returns an `account_name` that does not exist in the target Book. `resolveTargetAccount` expects `targetBook.getAccount(name)` to return nothing and then record without an Account, but `bkper-js` 2.37.0 raises a 404 `BkperError` ("Account NOT found!"), so no drafts are created and the event reports an error. Observed in Bookbot production on 2026-11-03; Parser Bot has the same code. Same root cause as the discovery API's `FORBIDDEN` for an Account from another Book.
- Multi-Book imports are not atomic: drafts are created per target Book in sequence; if a later Book fails, earlier drafts remain and no summary or file update is written.
- The posted/updated handler runs invoice learning and statement flagging; rediscovery was removed and belongs to Bookbot.
- The attachment path retains its own file-metadata filter, moved verbatim into `AttachmentExtractionService`. Unlike the import path's `filterFileProperties`, it does not drop `transactions_summary`. Do not merge the two.

## Local verification

```bash
bun run api               # Generate client types and OpenAPI snapshot after contract changes (also Bookbot client types)
bun run api:check         # Verify contract freshness
bun run typecheck
bun run typecheck:tests
bun run build             # Wrangler dry-run only
bun run test:unit         # Clears live AI variables; integration cases skip
bun run test-git-flow     # Isolated temporary repositories only
bun run test              # All of the above
```

Event handlers call Bookbot's discovery API through `src/services/BookbotDiscoveryClient.ts`. When Bookbot's contract changes, copy `bookbot/test/api/openapi.snapshot.json` to `src/clients/bookbot/openapi.json` and run `bun run api`. Local runs cannot call Bookbot (local outbound authorizes only the Bkper API and Bkper AI); tests use the doubles in `test/helpers/bookbot-discovery.ts`.

Existing tests and fixtures remain unchanged. Focused API tests cover read-only behavior, canonical payloads, authorization, error handling, and external parser compatibility. For refactoring, follow the rules above. Run `bun run test` after each step.

The legacy branch scripts under `scripts/` are retained solely for their isolated regression tests. Do not use them to manage this monorepo's branches.

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

`baseline-manifest.json` records SHA-256 digests of the baseline files, including tests and fixtures. Files a change does not need to touch should still match it. List changed files with `jq -r 'to_entries[] | "\(.value)  \(.key)"' baseline-manifest.json | sha256sum -c --quiet`; new files appear only in `git status`.

The source/fixture owner confirmed redistribution rights and that document fixtures are synthetic. The monorepo MIT license covers Bkper-owned source; dependencies retain their own licenses. No private repository history, credentials, operational rollout plan, or generated build output belongs in this public source snapshot. Re-review the final tree and dependency notices before any publication.

The API adds explicit canonical Bkper types and OpenAPI type generation dependencies to `package.json` and `bun.lock`. The new generator dependency tree expands the lockfile; existing runtime dependency versions remain pinned. Parser Bot now uses its own ignored `node_modules` installation, not the reference checkout's symlink. Installation scripts are disabled for local verification. Final publication review remains separately gated.
