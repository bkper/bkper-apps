# Tax Bot Migration

Follow [`ROADMAP.md`](./ROADMAP.md) for the approved GCP-to-Cloudflare migration plan.

## Layout

- `legacy/` — accepted Google Cloud Functions source baseline, active production implementation, and production webhook configuration.
- `new/` — isolated Cloudflare Worker migration target with deterministic parity, preview deployment, developer routing, and deterministic preview validation complete; final drift audit and production deployment remain.

The end-user README, license, roadmap, and deferred bug ledger remain at the migration root. The production GCP configuration remains under `legacy/`; the preview deployment and developer routing configuration live under `new/`. Do not treat the migration root as a deployable app.

## Working rules

- Keep migration chunks small and independently reviewable.
- Do not intentionally change legacy tax behavior during parity work.
- Protect Bkper's zero-sum invariant: every posted tax Transaction must be one complete movement with one amount, one origin Account, and one destination Account. Unresolved movements must remain drafts.
- Never mutate a source Transaction. Create or trash only its linked tax Transactions.
- Apply active GCP patches under `legacy/` until cutover. Record each patch in the roadmap ledger and translate it into a deterministic parity test and the Cloudflare implementation when applicable.
- Never use live Books for implementation tests.
- Do not sync, deploy, install, replay events, change routing, run canaries, or perform Book writes without explicit approval immediately before the operation.

## Legacy verification

The migration baseline has no deterministic unit-test suite. Its existing local verification command is:

```bash
cd legacy
bun run build
```

Preserve and document verification limitations rather than repairing unrelated behavior during a migration chunk.
