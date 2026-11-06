# Deferred legacy behavior

These are observations, not changes approved for this refactoring.

- Legacy discovery swallows dependency failures. `ExtractorDescriptionParts.extract` returns empty parts after failed inference, which discovery can cache before trying fallback history queries. Failed history queries count as empty history. The discovery API propagates failures only to its callers, through optional error hooks; changing event failure/fallback behavior requires separate approval.
- `discoverProperties` can add visible properties before malformed existing `agent_discovered_properties_` JSON makes provenance processing fail. Its default best-effort behavior is retained. The API returns the original supplied transaction on failure rather than partial suggestions; no Book changes are persisted.
- Exact-phrase history search does not match descriptions containing `$` or `,` (for example `250un x $20,00`), even when identical posted transactions exist. Discovery then depends on AI-extracted description parts, which omit quantities and amounts, so descriptions made only of quantity and price find no match. This is existing legacy behavior.
