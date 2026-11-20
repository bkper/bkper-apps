# Deferred legacy behavior

These are observations, not changes approved for this refactoring.

- Legacy discovery swallows dependency failures. `ExtractorDescriptionParts.extract` returns empty parts after failed inference, which discovery can cache before trying fallback history queries. Failed history queries count as empty history. The discovery API propagates failures only to its callers, through optional error hooks; changing event failure/fallback behavior requires separate approval.
- `discoverProperties` can add visible properties before malformed existing `bookbot_discovered_properties_` (or earlier `agent_discovered_properties_`) JSON makes provenance processing fail. Its default best-effort behavior is retained. The API returns the original supplied transaction on failure rather than partial suggestions; no Book changes are persisted.
- Exact-phrase history search misses descriptions with a comma between digits, such as `250un x $20,00`, even when identical posted transactions exist. Core's query parser rewrites every digit-comma-digit in a query to a dot (`QueryParser`, "Avoid comma", meant for decimal-comma amounts), so the phrase becomes `250un x $20.00` and no longer matches the stored text. `$` and other commas are not the cause. Discovery then depends on AI-extracted description parts, which omit quantities and amounts, so descriptions made only of quantity and price find no match. Possible fixes: in Bookbot, replace digit-comma-digit with a space in the search phrase only (`"250un x $20 00"` matches exactly the `$20,00` transactions); or, in Core, stop rewriting commas inside quoted text, which would also fix the same search in Bkper.
- `@typesafe-ai/sdk` 0.7.0 fails under Bun with `TypeError: Body already used` while buffering every response, in-memory or real, so unit tests and scripts cannot use it; Bookbot stays on 0.6.0, like Merge Duplicates and Report. 0.7.0 was not tried on the Workers runtime.
- After an Account is reclassified, such as a subscription moved from one expense Account to another, Jev keeps ranking the old Account first while it dominates the 15 transactions read; counting the 3 most recent switched sooner. Weighting recency more would need its own end-to-end measurement.

## Follow-ups from Extractor Bot's move to `extractor-bot`

Observations recorded while moving Extractor Bot to its permanent app ID and giving both apps their own properties; none is approved yet.

- Extractor Bot's date extraction ignores the Book's date pattern. `ExtractorDate` lists both DD/MM/YYYY and MM/DD/YYYY, so an ambiguous date such as 01/11/2026 resolves inconsistently (observed as November 1 and January 11 for the same text on a dd/MM/yyyy Book). Pass the Book's `datePattern` to the model.
- Extractor Bot and Bookbot log full SDK errors in their event handlers (`console.error(err)`). On 401/403 responses these messages carry user emails and Book names. Log the error code and a generic message instead.
- Extractor Bot logs a missing source file on `TRANSACTION_DELETED` (`File … not found`) as an error; a bulk deletion produces one error line per transaction. Log it as information.
- Core's event replay and Book copy should skip apps that no longer exist, instead of assuming every installed app is still registered.

