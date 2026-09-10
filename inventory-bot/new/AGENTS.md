# Inventory Bot Cloudflare Migration Target

This directory contains the isolated full-stack Cloudflare migration target for Inventory Bot.

## Current scope

- Chunks 1 through 14 are complete. The production baseline, accepted source-over-deployment COGS deletion hardening, Cloudflare skeleton, event behavior and parity audit, typed Account-level API contract, authenticated client context and visible operation scope, server authorization boundaries, Account-level Reset, Account-level Calculate, migrated menu client, completed full-stack behavior, dependency, and runtime audit, established preview deployment and development routing, and authoritative isolated-Book event validation are recorded in `../ROADMAP.md`.
- Chunk 15 is complete for the accepted validation scope. Calculate/Reset accounting scenarios, selected and Group scope, failure continuation, idle context changes, responsive themes, and Inventory lock/closing protection passed authoritative isolated-Book checks. All 206 unit tests and the complete local gate passed. See `../ROADMAP.md` for evidence and accepted live-coverage limits; unexercised live checks are coverage notes, not completion blockers.
- Chunk 16 is complete: the final deployed-code drift audit, frozen clean reinstall, complete local gate with 206 unit tests, and repeated byte-identical clean-output builds passed. The scoped dependency advisories and corrected unused updated-event artifact description are recorded in `../ROADMAP.md`. Frozen dependency pins remain unchanged; the vulnerability audit is not clean. The accepted production Worker is deployed, with OpenAPI, API/event authentication boundaries, and observed logs verified. A human confirmed the signed-in production client loads, completing the remaining client and asset delivery smoke check. Production routing was unchanged by that deployment; the subsequent combined cutover is recorded in Chunk 17.
- Chunk 17 is complete for the accepted observation scope: both production routes were confirmed on Cloudflare at 2026-09-09 18:42:33 UTC, and the shared twenty-four-hour gate elapsed at 2026-09-10 18:42:33 UTC. The retrospective read-only assessment through 19:40:45 UTC found 244 event POST requests, all with `200` and `ok` outcomes, no warning/error entries or reported log-coverage warnings, no result-limit saturation, and both persisted routes still on Cloudflare. Current OpenAPI and unauthenticated client/API/event probes returned the expected results. No rollback signal was detected in the retrieved evidence. The intervening production deployment at 17:12:03 UTC changes only Book links in event responses and does not restart the shared window. No production Calculate/Reset or signed-in menu workflow traffic was observed; this is an explicitly accepted coverage limit, not a blocker or a reason to initiate production mutations. Event details and accounting outcomes are not established by HTTP success; retained deterministic and accepted preview evidence remains the accounting basis. The full local gate passed again when recording completion: all 206 unit tests, strict typechecks, generated contracts, client and Worker production builds, formatting, and generated-file drift checks. There was no unattended monitor after the first hour. See `../ROADMAP.md` for the full assessment and limits. Event and menu rollout are complete together; there is no separate menu stabilization cycle. Chunk 18 repository consolidation is next and remains unstarted. Retain GCP and GAS as rollback targets and obtain explicit approval before any remote mutation or legacy retirement.
- Manual UI review is complete for the exercised preview contexts, and the production page-load smoke check is complete; do not request more screenshots or initiate further Book/API mutations unless separately requested and approved. Any continuation must distinguish deterministic coverage, human-reported page loading, and live accounting evidence. Further remote mutations require separate approval; the completed cutover does not authorize replays, operation retries, or additional Book writes.
- The legacy GCP event handler under `../legacy/events/` and its unchanged deployed runtime remain the event rollback target.
- The legacy Google Apps Script web app under `../legacy/menu/` and its unchanged deployed runtime remain the menu rollback target.
- One deployed Cloudflare Worker is now production-authoritative for the bundled client, authenticated `/api/v1/*` routes, `/events`, and `/openapi.json`. Development routes remain on preview.
- Account-level Calculate and Reset mutations are limited to the ported legacy accounting behavior, and event mutations remain limited to the established checked, posting, unchecking, deletion, and linked-cleanup behavior.
- Do not inherit Portfolio Bot domain behavior, routes, event subscriptions, operation policies, or UI workflows.
- Protect Bkper's zero-sum invariant above all else. Every posted Transaction must remain one complete movement with one amount from an origin Account to a destination Account.
- Tests must never write to live Books.

## Local development

- Vite client: `5175`
- Worker: `8796`

```bash
bun install
bun run dev
```

## Verification

```bash
bun run check
```

The deterministic gate includes generated contracts, strict typechecks, client and server tests, production client and Worker builds, formatting, and generated-file drift checks.

Do not sync, deploy, install or uninstall the app, replay events, change routing, mutate legacy infrastructure, or write to Books without separate explicit approval.
