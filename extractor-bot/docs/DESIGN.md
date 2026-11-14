# Extractor Bot design

Extractor Bot reads documents, statements, attachments and descriptions. It extracts transaction fields and file metadata, asks Bookbot for Accounts, records unposted drafts, and learns from extraction corrections.

Extractor Bot started as a copy of the legacy Bookbot Worker. Account discovery and rediscovery belong to [Bookbot](../../bookbot/docs/DESIGN.md); Extractor Bot calls Bookbot's API and has no discovery code of its own.

Rules, responsibilities, events, properties, the parse API and known current behavior are in [AGENTS.md](../AGENTS.md). The discovery API Extractor Bot consumes is in [Bookbot's AGENTS.md](../../bookbot/AGENTS.md).

## Flow

```text
File uploaded, or transaction created with an attachment or a description
    -> extraction with Bkper AI (files with a parser URL belong to another app: skipped)
    -> Bookbot discovery API (one batch per target Book, or one item)
    -> deterministic merge: keep supplied values, apply only Account sides and properties
    -> unposted drafts, attachments and the file's extractor_transactions_summary
    -> the user reviews and posts

Posted correction of extracted fields, deleted imported draft, Book audit
    -> extraction learning (prompt updates, statement flags)

Bkper Agent, scripts and other apps
    -> POST /api/v1/extract, read-only
```

## Design choices

- **Read-only API.** `/api/v1/extract` reads and extracts but never writes. Event handlers own persistence.
- **Discovery outage does not discard parsing.** When Bookbot fails or is unreachable, Extractor Bot still records the parsed items as unposted drafts, keeps supplied fields, and reports the discovery failure as a `warning`. A valid no-match also produces drafts. Authorization or persistence failures still block that target write.
- **No blind reprocessing.** Files that already have `extractor_transactions_summary` (or the earlier `transactions_summary`) are skipped, and the summary lists only native transaction IDs that were actually recorded. Replays and retries must not duplicate drafts or overwrite later user corrections.
- **One owner per file.** Another app owns files with parser URLs. Extractor Bot keeps only the URL lookup, steps aside for those files and the drafts recorded from them, and never calls a parser URL.
- **Compatible properties.** Properties keep working under their earlier names: Extractor Bot reads `extractor_*` first, then the `agent_*` name. It writes only `extractor_*`; prompt and flag writes delete the old name on the same Account or Group in one update. Parser URLs are never rewritten, and transactions and files keep their old keys.
- **No posting.** Extractor Bot never posts. Drafts do not affect balances until a user posts them.

## What tests must cover

- Invoice, receipt, statement, CSV, image, attachment, metadata and description extraction, and stepping aside for files with parser URLs.
- Compatibility with Bookbot's contract and behavior when Bookbot fails.
- Extraction learning, kept separate from account rediscovery, including legacy transactions and prompt lookup precedence.
- Event loop prevention, duplicate deliveries, retries, stale snapshots and preservation of user corrections.
- Multi-Book import recovery and truthful summaries with native IDs only after recording.

Tests use doubles and synthetic fixtures. Live Books and paid inference need explicit approval.

## Out of scope

New extraction features, automatic posting and durable background processing, unless a demonstrated need justifies them.
