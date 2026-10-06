# Deferred legacy behavior

These are observations, not changes approved for this refactoring.

- Legacy discovery swallows dependency failures. `ExtractorDescriptionParts.extract` returns empty parts after failed inference, which discovery can cache before trying fallback history queries. Failed history queries count as empty history. Phase 1 propagates failures only for API callers through optional error hooks; changing event failure/fallback behavior requires separate approval.
- `discoverProperties` can add visible properties before malformed existing `agent_discovered_properties_` JSON makes provenance processing fail. Its default best-effort behavior is retained. The API returns the original supplied transaction on failure rather than partial suggestions; no Book changes are persisted.
