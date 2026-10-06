# Parser Bot plan

Parser Bot extracts transaction fields and file metadata from documents, statements, attachments, and descriptions. It records imports as unposted drafts, uses Bookbot for account discovery, and learns from extraction corrections.

Companion plan: [Bookbot](../../bookbot/docs/PLAN.md), which defines the shared rules and the discovery contract Parser Bot consumes.

## Status

- This directory is an inactive local snapshot of the legacy Bookbot Worker. It is not registered, deployed, or published. The permanent app ID is still to be confirmed; `parser-bot` is proposed.
- Phase 1 restarted from the unchanged baseline and has not started. Live migration waits for verification of the legacy Bookbot rename rollout.
- Pushing this repository publishes the source; it requires a final publication review and explicit approval.

## Refactoring rules

- This is a refactoring: preserve the code as much as possible. Change only what a stated boundary goal requires.
- Don't rewrite, fix, rename, reformat, or clean up. Record defects or improvement ideas for a later, separately approved change.
- When extracting, move code verbatim, keeping names, comments, and order.
- Keep diffs small, concise, human-readable, and easy to review: one focused step per commit.
- Add only the characterization tests needed, and keep them short. Existing tests change only mechanically.

## Responsibilities

Parser Bot owns:

- File classification and transaction extraction for one transaction, multiple transactions, and file metadata.
- Amount and date extraction from descriptions.
- External parser connectors, preserving their request contract. Top-level group context is sent only when the parser URL is configured on that group.
- Imported draft recording, attachments, target Books, and `transactions_summary`.
- Extraction provenance, correction learning, statement flags, and audit processing.
- Coordinating transaction-created events: extract, call Bookbot discovery, then perform the single draft update. Bookbot does not separately enrich the same event.

Parser Bot does not implement discovery. The duplicated discovery code in this snapshot is removed once Parser Bot consumes Bookbot's API.

## Events

| Event | Current behavior to preserve | Writes |
| --- | --- | --- |
| `FILE_CREATED` | Skip attachment uploads and files with `transactions_summary`; parse; discover per target Book; create drafts sequentially by target Book; record file metadata and summary. | Drafts in any target Book, file update, lazy prompt migration |
| `TRANSACTION_CREATED` with attachment | Require `upload_method=attachment`; extract the transaction and file metadata concurrently; fill missing fields, falling back to description extraction; set the amount-side Account; discover; record `agent_extracted_` when extracted values apply. | Transaction update, then file update; lazy prompt migration |
| `TRANSACTION_CREATED` without attachment | Discover first; extract amount only when missing and date only when `auto_filled_date_` exists; update once. | Transaction update |
| `TRANSACTION_POSTED` / `TRANSACTION_UPDATED` | Posted transactions only: invoice learning and statement flagging. Bookbot also subscribes for rediscovery. | Prompt and flag updates |
| `TRANSACTION_DELETED` | Flag statement learning from the event payload. | Flag update |
| `BOOK_AUDITED` | Improve the most recently flagged statement prompt. | Prompt update and flag clear |

## Properties

| Properties | Role |
| --- | --- |
| `agent_parser_transaction`, `agent_parser_transactions`, `agent_parser_file`, `agent_parser_url_*` | Parser configuration. Legacy `agent_prompt*` properties migrate lazily during lookup; legacy `agent_parser_url` is intentionally unsupported. |
| `upload_method`, `account_id`, `group_id`, `auto_filled_date_` | Source and context inputs read by extraction. |
| `agent_extracted_`, `agent_file_id_`, `agent_prompt_improve_`, `transactions_summary`, extracted transaction and file properties | Extraction provenance, learning state, and recording receipts. |
| `parsed_account_name_` | Produced by extraction for Bookbot discovery. |
| `agent_credit_account_id_`, `agent_debit_account_id_` | Bookbot provenance read by statement learning. |
| `agent_excluded_properties`, legacy `agent_prompt_skip` | Exclusions shared with Bookbot. Both read; neither writes. |

## API direction

- Follow the shared conventions in Bookbot's plan: versioned routes, OpenAPI, one implementation for single and batch, per-item results, and target-Book authorization.
- Expose raw extraction independently from optional discovery composition. A composed operation calls Bookbot's public API and reports extraction and discovery outcomes separately.
- Read-only results never contain native transaction IDs or claim drafts were recorded. Summaries are written by the recording adapter after successful writes.
- Read-only parsing must not run the legacy prompt migration. Inject a non-persisting migration into `PromptLookupService`.

## Agreed policies for migration

- **Discovery outage:** do not discard successful parsing. Record parsed items as unposted drafts, preserve supplied fields, and report the discovery failure distinctly. Valid no-match may also produce unposted drafts. Authorization or persistence failure still blocks that target write, and partial results identify what was actually recorded.
- **Installation:** Books currently receiving parsing through Bookbot receive Parser Bot automatically during the separately approved migration. First resolve the installation principal, permissions, AI allowance, and duplicate-processing safeguards.
- Before cutover, specify idempotency, partial-batch and cross-Book recovery, stale-update protection, summary completion, and replay behavior. Never enable legacy and Parser Bot processing for the same events or reprocess recorded imports blindly.

## Phase 1 steps

Work only in `parser-bot/`, on code Parser Bot owns. Non-owned code stays identical to `baseline-manifest.json`.

Existing boundaries need no change: `FileParserRouter` already returns `FileParsingResult` without recording, `ExtractorAmount` and `ExtractorDate` already extract description fields, and learning services are already separate from event handling.

Characterize first. Each test must pass against unchanged code:

- **P1.** Without an attachment, discovery precedes amount and date extraction; extraction is conditional; there is one update or `result: false`.
- **P2.** With an attachment: a non-attachment upload does no extraction; extraction failure returns an error without writes; supplied fields remain; `agent_extracted_` is written only when extracted values apply; the transaction update precedes the file update.
- **P3.** File import: a parse failure writes nothing. If a later target Book fails, earlier drafts remain and no summary or file update is written.
- **P4.** Posted/updated: learning and rediscovery start concurrently; results join in invoice, statement, rediscovery order; one rejection fails the combined result.
- **P5.** Book audit: no flag, completed, and skipped results.

Check existing tests first and add only uncovered cases.

Then refactor:

- **P-R1.** Move the handler's attachment extraction methods verbatim into `AttachmentExtractionService`. Only the two entry points become public; the handler calls them in the same `Promise.all` and keeps merging, discovery, writes, and the error message.
- **P-R2.** Move the lazy legacy prompt migration and its constant verbatim into `LegacyPromptPropertyMigration`, keeping the method name. `PromptLookupService` receives it with a persisting default and calls it at the same points. One test shows lookup can use a non-persisting migration, which a future read-only API needs.

Known current behavior to preserve and resolve in later phases:

- Multi-Book imports are not atomic.
- In the posted/updated handler, a rejected learning or rediscovery task fails the combined result.
- Prompt and parser-URL lookup can persist migrated prompt properties.

## Phases

1. **Boundaries and characterization.** Follow the Phase 1 steps above. Done when the characterization tests pass, both refactors are complete, existing assertions are unchanged, non-owned code still matches the baseline, and `bun run test` passes.
2. **Bookbot discovery API.** Implemented in Bookbot; this snapshot keeps working unchanged.
3. **Build Parser Bot.** Confirm the app ID. Consume Bookbot's API, remove local discovery and rediscovery, expose extraction APIs, and keep property names and external parser contracts compatible.
4. **Event and installation migration.** Apply the agreed policies with a controlled rollout and a rollback that never reprocesses recorded imports blindly.
5. **Publication.** Final license, security, fixture, and documentation review; `bkper.yaml`, README, and delivery workflow; explicit approval before pushing.

## Verification

- Invoice, receipt, statement, CSV, image, attachment, metadata, external parser, and description extraction behavior.
- Parser-to-Bookbot contract compatibility and outage handling.
- Extraction learning separate from account rediscovery, including legacy transactions and lookup precedence.
- Event loop prevention, duplicate deliveries, retries, stale snapshots, and preservation of user corrections.
- Cross-Book import recovery and truthful summaries with native IDs only after recording.
- Typechecks, contract freshness, deterministic tests, and production builds every phase. Tests use doubles and synthetic fixtures; live Books and paid inference require explicit approval.

## Deferred

New extraction features, automatic posting, logo redesign, and durable background processing without demonstrated need.
