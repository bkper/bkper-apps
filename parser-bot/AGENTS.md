# Parser Bot — Local Staging

## Status and safety

Read `docs/PLAN.md` for responsibilities, agreed decisions, contracts, and phase status before changing behavior or ownership.

This directory is an inactive, behavior-preserving snapshot of the legacy Bookbot extraction automation. Both staging directories initially contain the same runtime and tests; the responsibility split is not implemented yet. Bookbot is distinct from the managed conversational Bkper Agent.

- No app registration, deployment workflow, live webhook tooling, or production Worker configuration is included.
- Do not deploy, sync metadata, install, replay events, publish, or send real events to this snapshot without separate explicit approval.
- The copied self-hosted event authentication is not a public API authentication boundary.
- The snapshot's README describes the legacy Bookbot behavior. It is not a Parser Bot product listing.
- Keep README content public-facing; development information belongs here.
- Existing technical names and `agent_*` properties stay unchanged.
- Neither parser nor discovery should post transactions. Preserve explicit account sides, existing property behavior, legacy provenance, parser URL ownership, and target-Book access.
- Change only what the current phase in `docs/PLAN.md` needs. Do not silently implement future API or outage policy.
- The eventual Parser Bot consumes Bookbot discovery through its API; duplicated discovery here is only a temporary baseline.

## Refactoring rules

- Goal: split the two apps into isolated business processes with the least code change possible. Current behavior works; don't break it.
- Don't rewrite, fix, rename, reformat, or clean up. Record defects or ideas for a separate, approved change.
- Move code verbatim, keeping names, comments, and order.
- Keep diffs small and easy to review: one focused step per commit.
- Before changing behavior that tests don't cover, add a short test of the current behavior. Existing tests change only mechanically.

## Local verification

```bash
bun run typecheck
bun run typecheck:tests
bun run build             # Wrangler dry-run only
bun run test:unit         # Clears live AI variables; integration cases skip
bun run test-git-flow     # Isolated temporary repositories only
bun run test              # All of the above
```

No new behavioral tests are needed for the snapshot itself: runtime, existing tests, and fixtures are unchanged. For refactoring, follow the rules above. Run `bun run test` after each step.

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

`baseline-manifest.json` records SHA-256 digests of the baseline files, including tests and fixtures. Files a phase does not need to change should still match it. List changed files with `jq -r 'to_entries[] | "\(.value)  \(.key)"' baseline-manifest.json | sha256sum -c --quiet`; new files appear only in `git status`.

The source/fixture owner confirmed redistribution rights and that document fixtures are synthetic. The monorepo MIT license covers Bkper-owned source; dependencies retain their own licenses. No private repository history, credentials, operational rollout plan, or generated build output belongs in this public source snapshot. Re-review the final tree and dependency notices before any publication.

Package dependencies and `bun.lock` are preserved from the baseline. For this local session, ignored `node_modules` symlinks reuse the reference checkout's existing installation without downloading dependencies. A clean-install/frozen-lockfile verification remains necessary before publication.
