# Subledger Bot Migration

Follow [`ROADMAP.md`](./ROADMAP.md) for the approved GCP-to-Cloudflare migration plan.

## Layout

- `legacy/` — current Google Cloud Functions implementation and the production-authoritative source until the production webhook cutover.
- `new/` — Cloudflare Worker migration target. Its minimal server-only skeleton is in place; business behavior remains to be ported.

The end-user README and published app configuration remain with the deployable implementation. Do not treat the migration root as a deployable app.

## Working rules

- Keep migration chunks small and independently reviewable.
- Do not intentionally change legacy business behavior during parity work.
- Protect Bkper's zero-sum invariant: a consolidated transaction must represent one complete movement with one amount; unresolved movements must remain drafts.
- Apply production GCP patches under `legacy/` until cutover. Record each patch in the roadmap ledger and translate it into a deterministic parity test and the Cloudflare implementation when applicable.
- Never use live Books for implementation tests.
- Do not sync, deploy, install, change event routing, or perform Book writes without explicit approval immediately before the operation.

## Legacy verification

The migration baseline has no unit-test suite. Its existing local verification command is:

```bash
cd legacy
bun run build
```

If a pre-existing verification failure is observed, preserve and document it rather than repairing it in a rename-only migration chunk.
