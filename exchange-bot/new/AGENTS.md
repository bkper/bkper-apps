# Exchange Bot Cloudflare Target

This directory is the isolated Cloudflare migration target. The production GCP event handler and Apps Script menu under `../legacy/` remain authoritative.

## Current scope

- Full-stack parity, dependency, build, generated-artifact, and local runtime auditing are complete; preserve the audited behavior without refactoring or feature changes.
- Preview deployment and routing readiness are next. No preview or production deployment has been performed.
- The legacy GCP event handler and Apps Script menu remain production-authoritative.
- Team-wide developer access is the intended final metadata state, but preview sync must preserve the temporary single-operator restriction while local tunnels may still run. Restore team-wide access only after stabilization as recorded in the roadmap.
- Protect Bkper's zero-sum invariant; tests must never write to live Books.

## Local development

- Vite client: `5177`
- Worker: `8793`

```bash
bun install
bun run dev
```

## Verification

```bash
bun run check
```

Do not sync, deploy, configure secrets, install the app, replay events, change routing, or write to Books without separate explicit approval.
