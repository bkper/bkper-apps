# Inventory Bot Cloudflare Migration Target

This directory contains the isolated full-stack Cloudflare migration target for Inventory Bot.

## Current scope

- Chunks 1 through 14 are complete. The production baseline, accepted source-over-deployment COGS deletion hardening, Cloudflare skeleton, event behavior and parity audit, typed Account-level API contract, authenticated client context and visible operation scope, server authorization boundaries, Account-level Reset, Account-level Calculate, migrated menu client, completed full-stack behavior, dependency, and runtime audit, established preview deployment and development routing, and authoritative isolated-Book event validation are recorded in `../ROADMAP.md`.
- Chunk 15 is complete for the accepted validation scope. Calculate/Reset accounting scenarios, selected and Group scope, failure continuation, idle context changes, responsive themes, and Inventory lock/closing protection passed authoritative isolated-Book checks. All 206 unit tests and the complete local gate passed. See `../ROADMAP.md` for evidence and accepted live-coverage limits; unexercised live checks are coverage notes, not completion blockers.
- Chunk 16 is complete: the final deployed-code drift audit, frozen clean reinstall, complete local gate with 206 unit tests, and repeated byte-identical clean-output builds passed. The scoped dependency advisories and corrected unused updated-event artifact description are recorded in `../ROADMAP.md`. Frozen dependency pins remain unchanged; the vulnerability audit is not clean. The accepted production Worker is deployed, with OpenAPI, API/event authentication boundaries, and observed logs verified. A human confirmed the signed-in production client loads, completing the remaining client and asset delivery smoke check. Production routing remains unchanged. Chunk 17 is next: one explicitly approved combined production webhook and menu cutover, followed by parallel observation of both surfaces for one hour and then twenty-three additional hours (twenty-four hours total). Assess both together at the one-hour checkpoint and mark both rollout surfaces complete together at the twenty-four-hour gate only when observability evidence supports it. Initiate rollback immediately if needed during either phase, retaining GCP and GAS as rollback targets and obtaining explicit approval before remote sync. There is no separate menu stabilization cycle. Repository consolidation follows in renumbered Chunk 18.
- Manual UI review is complete for the exercised preview contexts, and the production page-load smoke check is complete; do not request more screenshots or initiate further Book/API mutations unless separately requested and approved. Any continuation must distinguish deterministic coverage, human-reported page loading, and live accounting evidence. Production runtime deployment did not authorize metadata sync, webhook cutover, or menu cutover.
- The legacy GCP event handler under `../legacy/events/` remains production-authoritative for events.
- The legacy Google Apps Script web app under `../legacy/menu/` remains production-authoritative for the menu.
- One deployed Cloudflare Worker serves the bundled client, authenticated `/api/v1/*` routes, `/events`, and `/openapi.json`; production menu and event routing still use the legacy runtimes.
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
