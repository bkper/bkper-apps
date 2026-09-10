# Inventory Bot

This directory is the active full-stack Cloudflare application for Inventory Bot. The client, API, and event handler share one Worker. The former `new/` and `legacy/` working-tree directories have been consolidated; legacy source remains recoverable from Git history.

## Project map

- `client/src/` — Lit client, authentication, Book context, visible Account scope, sequential Calculate/Reset orchestration, and generated API types.
- `client/test/` — deterministic client unit tests.
- `server/src/api/` — authenticated Account-level Calculate/Reset routes, authorization, and ported FIFO services.
- `server/src/events/` — four subscribed event handlers, interceptors, quantity mirroring, and linked lifecycle behavior.
- `server/src/shared/` — request-scoped Platform SDK context, constants, and optional resource lookups.
- `server/test/` — deterministic API, accounting, event, and SDK compatibility unit tests.
- `scripts/` — OpenAPI client-type generation.
- `bkper.yaml` — production/preview routing, metadata, subscriptions, and Worker configuration.
- `ROADMAP.md` — migration baseline, accepted differences, validation evidence, completed rollout and consolidation, and rollback procedure.
- `BUGS.md` — inherited issues deferred to separately reviewed post-migration work.

## Production and migration status

- Chunks 1 through 18 are complete for their recorded scopes. Chunk 17 accepted the combined production event/menu rollout after the shared twenty-four-hour window. No production Calculate/Reset or signed-in menu workflow traffic was observed in that assessment; this is an accepted coverage limit, not a reason to reopen stabilization or initiate production mutations.
- Production events and the menu route to Cloudflare; development routes remain on preview. HTTP success does not establish accounting correctness. Retained deterministic tests and accepted isolated preview validation provide the accounting evidence described in `ROADMAP.md`.
- Chunk 18 moved the accepted app to this root without changing application source, tests, dependency pins, lockfile, generated contracts, app metadata, or built artifacts. All 206 tests and the full local gate passed before and after the move, including a clean frozen reinstall at the final root.
- The unchanged deployed GCP handler and GAS menu remain independent routing rollback targets. Recovering legacy source or tooling requires Git history and a separate reviewed plan; deleting a local directory does not retire either deployed runtime.
- Developer access remains unchanged. Restoring normal developer access is a separate metadata change requiring explicit approval, not part of the completed local consolidation.
- Dependency pins remain frozen. The advisory assessment in Chunk 16 is scoped, not a clean vulnerability audit; dependency modernization requires separate compatibility review.
- Manual UI review is complete for the exercised preview contexts, and the production page-load smoke check is complete. Do not request more screenshots or initiate Book/API mutations unless separately requested and approved. Distinguish deterministic coverage, human-reported page loading, and authoritative live accounting evidence.

## Domain and safety boundaries

- Protect Bkper's zero-sum invariant above all else. Every posted Transaction is one complete movement from an origin Account to a destination Account. Inventory quantities and Financial amounts remain independently balanced in their respective Books.
- Checked eligible purchases mirror `Buy >> item`, sales mirror `item >> Sell`, and quantity-bearing supplier returns mirror `item >> Buy`. Missing or unresolved inputs must not create unintended posted movements.
- Calculate preserves accepted FIFO ordering, splits, costs, logs, checked state, and complete `item >> Cost of goods sold` Financial movements. Rebuild invokes Reset and returns. Reset preserves accepted generated-movement cleanup and parent restoration.
- Preserve remote-id uniqueness, lifecycle selection, mutation ordering, and awaited completion. Do not silently fix the inherited classifiers or Book-role behavior documented in `BUGS.md` and `ROADMAP.md`.
- The same rendered eligible Account list defines Calculate and Reset scope for Account, Group, and whole-Book contexts. Execute sequentially, continue after individual Account failures, prevent duplicate submission, retain operation-owned UI context, and never retry mutations automatically. Reset has no additional confirmation dialog.
- Each Account-level API request authoritatively resolves its Inventory Account and Financial Book and requires `EDITOR` or `OWNER` permission and Inventory Bot installation on both Books before invoking accounting behavior. Client controls are not an authorization boundary.
- Server code uses request-scoped Platform SDK contexts without OAuth, API-key, or agent-id providers. Never read or forward credential headers in application code.
- Do not inherit Portfolio Bot domain behavior or redesign accounting logic during maintenance without a separately accepted change.
- Tests must never write to live Books. Retain deterministic SDK, network, API, browser, clock, and UUID boundaries.

## Local development

- Vite client: `5175`.
- Worker: `8796`.
- Run all commands from this directory, not the former `new/` path.

```bash
bun install --frozen-lockfile
bun run check
```

`bun run dev` starts both local surfaces. It can update development webhook routing; review that remote effect and obtain explicit approval before starting it. No secret or storage service is currently declared.

## Verification

`bun run check` covers generated API types, strict client/server/test typechecks, all 206 client/server unit tests, production builds, formatting, and generated-file drift. It performs no deployment or live Book mutation. Use existing coverage for behavior-preserving refactors; add focused tests first for behavior changes. Never mix inherited bug fixes or dependency upgrades into a structural move.

For visual/UI changes, verify the completed interface in the intended embedded/standalone contexts, themes, and widths using the browser skill with deterministic fixtures and no live Book writes. A file relocation with byte-identical client assets is not a visual change.

Do not sync, deploy, change access, install or uninstall the app, replay events, change routing, mutate legacy infrastructure, or write to Books without separate explicit approval. Show the exact remote mutating command before execution. Preserve GCP and GAS rollback targets until retirement is separately planned and approved.
