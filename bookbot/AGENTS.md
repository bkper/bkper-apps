# Bookbot — Platform App

## Status and safety

Read the responsibilities, events, properties and discovery API below before changing behavior or ownership.

This directory is the Platform Bookbot. It finds From and To Accounts and historical properties for transactions: the discovery API (`/api/v1/discovery`, used by apps, agents and scripts) and rediscovery of pending drafts on `TRANSACTION_POSTED`/`TRANSACTION_UPDATED` after an Account correction. Bookbot is distinct from the managed conversational Bkper Agent.

- It is a standard Bkper Platform app, deployed with `bkper app build` and `bkper app deploy` (`--preview` for preview). Never use `wrangler deploy`.
- `bkper.yaml` here is the source of truth for the live `bookbot` registration. Never sync from the retired legacy `bkper-agent` repository: its registration would route events to a Worker that no longer exists. There is no rollback to the legacy Worker.
- Do not deploy, sync metadata, install, replay events, publish, or send real events without separate explicit approval. Before deploying, confirm the build log reports `Build complete` without errors.
- Event handlers and API routes use Platform authentication: `new Bkper()` with outbound-injected authorization. Never read `bkper-oauth-token`, `bkper-agent-id`, or `Authorization` headers.
- The README is Bookbot's public listing: account discovery, rediscovery and the discovery API.
- Keep README content public-facing; development information belongs here.
- Existing technical names stay unchanged. Bookbot's properties are `bookbot_*`; read the new name first, then the earlier `agent_*` name (`getProperty(NEW, OLD)`), write only the new name, and remove the earlier name from a draft Bookbot updates only when present (`setProvenanceProperty`). `agent_excluded_properties` stays shared and unrenamed.
- Discovery never posts or writes from the API. Preserve explicit account sides, existing property behavior, legacy provenance, and target-Book access.
- Change only what the task needs. Do not silently implement future API or outage policy.
- Bookbot does not read documents or learn from extraction; callers send it drafts. Do not add those jobs here.

## Refactoring rules

- Goal: keep Bookbot an isolated business process with the least code change possible. Current behavior works; don't break it.
- Don't rewrite, fix, rename, reformat, or clean up. Record defects or ideas for a separate, approved change.
- Move code verbatim, keeping names, comments, and order.
- Keep diffs small and easy to review: one focused step per commit.
- Before changing behavior that tests don't cover, add a short test of the current behavior. Existing tests change only mechanically.

## Rules

- Preserve Bkper's zero-sum model. Bookbot never posts transactions; unresolved results remain unposted drafts.
- AI suggests. Deterministic application code validates, merges, and controls financial writes.
- Reusable APIs return results without Book writes; Book reads and inference are allowed. Event adapters or explicitly authorized callers own persistence.
- API calls need authorization for every target Book, not app installation. Event automation requires installation.
- Hosting: one standard Bkper Platform app serving `/events`, `/api/v1/*`, and `/openapi.json`. Event and API code use `new Bkper()` with Platform outbound authentication. Callers reach `https://bookbot.bkper.app/api/v1/*` through Platform outbound, which delegates user or event context without exposing credentials (app chain, loop and hop limits enforced by Dispatch). The legacy Worker is only a rollback target and is never called.
- Preserve explicitly supplied accounts and properties, existing `agent_*` properties, and legacy provenance.
- Do not log credentials, document content, transaction descriptions, or private Book data.

## Responsibilities

Bookbot owns:

- Account discovery from description, hashtags, a known account, and posted history.
- Discovery of common historical properties and its provenance.
- Rediscovery of affected pending drafts after a discovered account is corrected, including persisting those updates.

## Events

| Event | Bookbot behavior |
| --- | --- |
| `TRANSACTION_POSTED` / `TRANSACTION_UPDATED` | Rediscover pending drafts when a discovered account was corrected. |

Bookbot does not handle file or transaction-created events. Callers that record drafts call the discovery API first. This directory contains only discovery, rediscovery and the discovery API.

## Properties

| Properties | Role |
| --- | --- |
| `bookbot_credit_account_id_`, `bookbot_debit_account_id_`, `bookbot_discovered_properties_` (earlier `agent_*` names), `bookbot_confidence_`, plus discovered visible properties | Discovery results and provenance on drafts. Bookbot produces them; whoever records the draft persists them (the caller for API results, Bookbot for rediscovery). `bookbot_confidence_` is Jev's confidence in the option it ranked first, at least 0.95, or `1.00` when the search found one option, two decimals, hidden so mirroring apps such as Subledger and Exchange Bot do not copy it. When the input draft carries an earlier name, the result returns it as an empty value, the SDK's removal. Extractor Bot reads the account-side provenance under both names; keep these names stable. All keys ≤ 30 characters (`test/property-names.test.ts`). |
| `bookbot_description_part_`, `agent_description_part_` | No longer written. Discovery removes either from a draft where it fills a side, only when present. |
| `agent_excluded_properties`, legacy `agent_prompt_skip` | Property keys discovery never copies. Bookbot reads them and never writes them; other apps may read the same property. |
| `parsed_account_name_` | Set by Bkper when a created transaction's description names one Account. Discovery uses it as the known Account and removes it locally. |

## Discovery API

Bookbot provides this API to apps, agents and scripts.

- Versioned `/api/v1/*` operations with a published `/openapi.json` and generated client types.
- Single and batch calls share one item contract and implementation. Stable client item identifiers correlate results.
- Inputs identify the target Book and include transaction context, known account sides, description and hashtags, relevant properties, and optional verified creator or source context. Do not trust caller-supplied identities to select permissions or an execution principal.
- Outputs include suggested account sides, proposed historical properties, an outcome, and bounded provenance. Report no-change separately from no-match, and both separately from dependency failures. `bookbot_confidence_` is Jev's confidence, not calibrated on real Books: do not present it as the probability that the suggestion is right. It measures how concentrated Jev's probabilities are, so 0.06 on two options means about 53/47.
- Validate that suggested Accounts belong to the authorized target Book. Preserve known sides and supplied visible properties. Return the existing discovery `.json()`, including consumed `parsed_account_name_` context and updated internal `bookbot_*` provenance.
- Use one request-scoped discovery context per target Book to retain cache benefits. Preserve baseline sequential processing, caches and the existing external-request limit; honor request cancellation. No new batch-size, concurrency or deadline controls are introduced in this refactoring.
- Do not expose raw SDK objects, private event payloads, or full historical datasets.

### Contract

- `POST /api/v1/discovery` accepts `{ itemId, bookId, transaction, sourceAccount? }`; batch at `POST /api/v1/discovery/batch` accepts `{ items: [...] }` with unique client item IDs.
- `transaction` is canonical `bkper.Transaction`; `sourceAccount` is canonical `bkper.Account` and enables property enrichment from the history found by account discovery. Account context requires an ID; other resource metadata is not trusted for authorization or configuration.
- Each result is `{ itemId, bookId, transaction, outcome, error? }`, where outcome is `changed`, `no_change`, `no_match` or `error`, and error is `{ code, message }`. Valid requests return HTTP 200 with per-item outcomes, including partial-batch failures; invalid requests return HTTP 400. No-change means both Account sides are supplied or the description is blank. No-match means no Accounts were discovered. Failed items return their original supplied transaction, not partial suggestions.
- Platform bearer authentication and outbound authorization are used. Each target Book requires `VIEWER`, `POSTER`, `EDITOR` or `OWNER`; installation is not required for API calls. Legacy event authentication is unchanged.
- The Platform owns caller/app-chain attribution. Discovery inference is attributed to Bookbot and uses the allowance of the authenticated principal, including their Business-domain pool where applicable. Caller-supplied identity never chooses permissions or allowance.
- `transaction.createdBy` is used as a lookup hint only when verified against the authenticated user or an existing transaction in the target Book. Otherwise it is excluded from lookup but preserved in the returned payload.
- `/openapi.json` defines the contract; `src/api/generated/types.d.ts` references canonical Bkper resource types. `bun run api` regenerates types and the reviewed contract snapshot; `bun run api:check` checks freshness.

## Known current behavior

- Discovery reads Books and runs inference but persists nothing. The API reuses `Discovery.discover` and `Discovery.discoverProperties`.
- Account choice (`src/services/AccountChoice.ts`): searches run one at a time, from the known Account and creator to the whole Book and from the most specific description part to the broadest; the first search that fills the draft decides, and searches are never mixed. Each search reads 15 posted transactions. Options are the Accounts for the draft's empty sides (From → To pairs when both are empty), without an Account already on the other side or the one Bookbot suggested before on that side. A single option is filled without a model call. Several are ranked by Jev (`src/genai/AccountChooser.ts`, `@typesafe-ai/sdk` 0.6.0) in one `choice`, with no "None of these"; code fills its first choice through the existing side checks only when Jev's confidence is at least 0.95 (`MIN_JEV_CONFIDENCE`). Below it, discovery stops with no suggestion and does not try broader searches. The threshold was chosen and checked with `eval/discovery-books/`; it depends on Jev's version, so re-check it there when Jev changes. Property discovery reads only the chosen option's transactions and needs at least 2. A Jev failure is a dependency failure, with no fallback to counting or another model.
- `bookbot_discovery_examples` and `agent_discovery_examples` are no longer read; description parts use the built-in examples.
- Legacy dependency failures resemble no-match: discovery catches failures, a failed history query counts as empty, and the concrete description extractor catches inference failures and returns empty parts (so fallback searches can still match). Optional error hooks propagate these failures only for API callers; default event behavior is unchanged. See [deferred behavior](docs/DEFERRED.md).
- Rediscovery returns `null` when no account changed or the change was not made by discovery, stops when the backlog exceeds 50, and considers one `is:draft` query with limit 100.

## Local verification

```bash
bun run api               # Regenerate OpenAPI snapshot and canonical client types
bun run api:check         # Check contract freshness
bun run typecheck
bun run typecheck:tests
bun run build             # Wrangler dry-run only
bun run test:unit         # Clears live AI variables; integration cases skip
bun run test              # All of the above
```

Tests for removed code were deleted with it. Short failure characterizations and API safety/contract tests cover the discovery API. API routes rely on Platform authentication and outbound authorization, not the legacy event headers. Run `bun run test` after each step.

## Evaluations

`eval/system-one/` compares System One decision models on synthetic discovery cases. It is not part of the app bundle. `bun run eval:system-one --check` confirms its `RESULTS.md` matches the recorded responses offline. `--live` makes paid calls and needs separate approval.

`eval/discovery-books/` measures discovery on real Books: each case is a posted bank transaction turned into a draft that holds only the bank side, with searches limited to history before its date, and scored right, wrong or no guess against the Account people posted. Its data is private client data in `bkper-clients/evals/bookbot-discovery/`, whose README has the method, the target a change must meet and the commands; never copy that data, or Book names, into this repository. The tools only read Books, with a guard that refuses any write before it is sent. A snapshot records every search the ladder can run, so changes after the searches replay without reading Books; changes to the searches need a new snapshot.

## Check and deploy

There is no CI workflow for this app. Run these from this directory: check locally, then deploy by hand with separate approval for each live step.

```bash
bun install --frozen-lockfile --ignore-scripts
bun run test              # Build, contract freshness, typechecks and unit tests
bkper app build           # Platform bundle in dist/; the log must say "Build complete" with no ERROR
bkper app deploy --preview   # bookbot-preview.bkper.app
bkper app deploy             # bookbot.bkper.app (production)
bkper app status
```

- Deploy and sync need a clean tree whose commit is pushed to `origin/main`. `bkper app deploy` uploads the existing `dist/`, so build from that commit first.
- `bkper app sync` replaces the live `bookbot` registration (events, properties, webhooks, README) with this directory's `bkper.yaml` and README. Run it only when they changed, never from the legacy `bkper-agent` repository.
- Never run `wrangler deploy`; `wrangler.jsonc` is for local development and the dry-run build only.
- After a deploy, check that `https://bookbot.bkper.app/openapi.json` matches `test/api/openapi.snapshot.json` and read the newest requests with `bkper app logs bookbot --events`.

Worker/inspector ports: 8807 / 9607. No UI/client port is needed. Local serving and event delivery are not part of baseline verification.

## Code conventions

- Strict TypeScript; use canonical Bkper types, never `as any` in new code.
- Imports at the top, external libraries first, internal paths with `.js` extensions.
- Four-space indentation, single quotes, semicolons.
- Prefer resource `.json()`; never manually map SDK getters to recreate API objects.
- Keep business behavior, connectors, transport, and persistence separate without forwarding-only layers.
- Model resources and From/To movements; deterministic application code controls financial writes.
- Read the Bkper core concepts and app quality/security references before changes; review changed code against quality guidance before completion.

## Source and redistribution

The source/fixture owner confirmed redistribution rights and that document fixtures are synthetic. The monorepo MIT license covers Bkper-owned source; dependencies retain their own licenses. No private repository history, credentials, operational rollout plan, or generated build output belongs in this public source snapshot. Re-review the final tree and dependency notices before any publication.

Bookbot uses its own ignored `node_modules` installation (`bun install --frozen-lockfile --ignore-scripts`). Keep `bun.lock` committed and in sync with `package.json`.
