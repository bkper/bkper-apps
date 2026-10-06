# Parser Bot plan

Parser Bot extracts transaction fields and file metadata from documents, statements, attachments, and descriptions. It records imports as unposted drafts, uses Bookbot for account discovery, and learns from extraction corrections.

Companion plan: [Bookbot](../../bookbot/docs/PLAN.md), which defines the shared rules and the discovery API Parser Bot consumes.

## Status

- This directory is an inactive local snapshot of the legacy Bookbot Worker. It is not registered, deployed, or published. The permanent app ID is still to be confirmed; `parser-bot` is proposed.
- No phase has started; the code is still the unchanged baseline. Live migration waits for verification of the legacy Bookbot rename rollout.
- Pushing this repository publishes the source; it requires a final publication review and explicit approval.

## Refactoring rules

- Goal: split the two apps into isolated business processes with the least code change possible. Current behavior works; don't break it.
- Don't rewrite, fix, rename, reformat, or clean up. Record defects or ideas for a separate, approved change.
- Move code verbatim, keeping names, comments, and order.
- Keep diffs small and easy to review: one focused step per commit.
- Before changing behavior that tests don't cover, add a short test of the current behavior. Existing tests change only mechanically.

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

## API direction

- Follow the shared conventions in Bookbot's plan: versioned routes, OpenAPI, one implementation for single and batch, per-item results, and target-Book authorization.
- Expose raw extraction independently from optional discovery composition. A composed operation calls Bookbot's public API and reports extraction and discovery outcomes separately.
- Read-only results never contain native transaction IDs or claim drafts were recorded. Summaries are written by the recording adapter after successful writes.
- Read-only parsing must not run the legacy prompt migration. Inject a non-persisting migration into `PromptLookupService`.
- Existing parts are reused unchanged: `FileParserRouter` already parses without recording drafts, `ExtractorAmount` and `ExtractorDate` already extract description fields, and learning services are already separate from event handling.

To agree before implementation: endpoint names, item/result/error shapes, and whether to offer the composed operation.

## Agreed policies for migration

- **Discovery outage:** do not discard successful parsing. Record parsed items as unposted drafts, preserve supplied fields, and report the discovery failure distinctly. Valid no-match may also produce unposted drafts. Authorization or persistence failure still blocks that target write, and partial results identify what was actually recorded.
- **Installation:** Books currently receiving parsing through Bookbot receive Parser Bot automatically during the separately approved migration. First resolve the installation principal, permissions, AI allowance, and duplicate-processing safeguards.
- Before cutover, specify idempotency, partial-batch and cross-Book recovery, stale-update protection, summary completion, and replay behavior. Never enable legacy and Parser Bot processing for the same events or reprocess recorded imports blindly.

## Known current behavior

- Prompt and parser-URL lookup can persist migrated prompt properties.
- Multi-Book imports are not atomic: drafts are created per target Book in sequence; if a later Book fails, earlier drafts remain and no summary or file update is written.
- The posted/updated handler runs learning and rediscovery together; one rejection fails the combined result.
- The attachment path has its own copy of the file-metadata filter. Unlike the import path's `filterFileProperties`, it does not drop `transactions_summary`. Move it verbatim; do not merge the two.

## Phases

Both plans use the same phases.

1. **Bookbot discovery API.** Done in Bookbot; this directory is unchanged.
2. **Parser Bot API.** Confirm the app ID before registering. Expose the extraction operations over the existing code. Only these moves are needed:
   - Move the attachment extraction methods (`extractAttachedTransaction`, `resolveTransactionParserAccount`, `extractFilePropertiesIfConfigured`, `filterFileProperties`, `shouldSkipFileProperty`) verbatim from `EventHandlerTransactionCreated` into `AttachmentExtractionService`; the handler calls it with the same behavior.
   - Move `migrateLegacyPromptProperties` and its constant verbatim into `LegacyPromptPropertyMigration`, injected into `PromptLookupService` with the persisting one as default; the API passes one that does not persist.
3. **Parser Bot uses Bookbot.** Event handlers call Bookbot's API instead of local discovery; remove the local discovery and rediscovery code. Keep property names and external parser contracts compatible.
4. **Event migration.** Apply the agreed policies with a controlled rollout and a rollback that never reprocesses recorded imports blindly.
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
