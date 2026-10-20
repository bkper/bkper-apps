# Bkper for Slack

Metadata-only Bkper App `bkper-slack`: the store listing and the Slack app setup of `@bkper`, Bkper Agent in Slack. No
code, client, server or deployment here. Its behavior lives in `bkper-clients/packages/channels` (private), shared by
every Slack bot; see `docs/plans/channels.md` there.

## Files

- `bkper.yaml`: the App. Keep it metadata-only: no `menuUrl`, `events`, `webhookUrl`, `propertiesSchema` or
  `deployment`, so it never installs on a Book and Core's bot loop prevention never applies. `id` is permanent: it is
  the bot id in channels URLs, the Agent workspace (account, App) and the attribution of Book changes.
- `slack-manifest.json` (prod, `channels.bkper.app`) and `slack-manifest.dev.json` (dev, `channels-dev.bkper.app`):
  filled-in copies of `packages/channels/slack/manifest.json`. Keep scopes and events equal to that template (its
  scopes are the code's `SLACK_SCOPES`); a scope change means every workspace reinstalls.
- `assets/`: `slack-logo.svg`, Slack's official mark, unmodified, is the App logo in Bkper (Apps page, Book history),
  where the surface is what tells it apart. `slack-app-icon.png` (1024px), the Bkper "b" on white, is the icon uploaded
  in Slack's app settings (Basic Information → Display Information), where Bkper is what tells it apart. In Slack the
  app stays "Bkper" (`@bkper`).
- `README.md`: the listing text. The "create your own bot" guide is on hold until Slack confirms customers may create
  one (`docs/plans/channels.md` §13); its steps stay there.

## Delivery

No workflow. `bkper app sync` from this folder creates or updates the App in prod Core;
`BKPER_API_URL=https://api-dev.bkper.app bkper app sync` in dev Core. Both are remote writes: only with approval.
Each environment has its own Slack app, created from its manifest, whose credentials are registered with
`PUT https://channels[-dev].bkper.app/slack/bkper-slack/credentials` (see `README.md`).
