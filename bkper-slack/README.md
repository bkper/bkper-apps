# Bkper Slack Bot

Ask about your Books and work on them from Slack. Tag `@bkper` in a thread, or message it, and Bkper Agent answers
right there, with the Books shared with the Bkper account your workspace chose.

## Add it to your Slack workspace

1. Open [Add to Slack](https://channels.bkper.app/slack/bkper-slack/install). A Slack workspace admin or owner installs it.
2. Sign in to Bkper with the account the bot will run as, and confirm.
3. Add `@bkper` to a channel and tag it, or message it directly.

## What to know

- **One account per workspace.** Everyone who uses `@bkper` in your Slack workspace acts with the chosen account's access
  to Books, and shares its conversations, including direct messages. Share with that account only the Books the
  workspace needs, as View only where the bot should not change anything.
- **Only admins change the account**, from the bot's Home tab in Slack.
- **Only workspace members** can use it: guests and people from other organizations get a polite refusal.
- **It asks before changing a Book.** To make sure it cannot change one, share that Book as View only.
- **Changes show as Bkper Slack Bot** in Book history, apart from Bkper Agent in the Book.
- **Uninstalling** the app from Slack removes its Slack token and the account choice.

## Create your own bot

This folder is also the example to copy for your own bot, such as `@acme`, with your own name and logo. You need to own
or develop a Bkper App, and no one at Bkper is involved.

1. Copy this folder. In `bkper.yaml`, set a new `id` (it becomes the bot id and cannot change), `name`, `description` and
   logos, then run `bkper app sync`. Use an App only for the bot, never one that does other work: the bot's Book
   changes carry its App id, and Bkper does not send an App events caused by its own changes.
2. In `slack-manifest.json`, replace `bkper-slack` with your App id in the three URLs, and set your Slack app's name and
   handle. Create a Slack app [from the manifest](https://api.slack.com/apps?new_app=1). Slack cannot verify the events
   URL yet; that is expected.
3. Register the Slack app's credentials (Slack: Basic Information → App Credentials) with Bkper:

   ```sh
   curl -X PUT https://channels.bkper.app/slack/<your App id>/credentials \
     -H "Authorization: Bearer $(bkper auth token)" -H 'Content-Type: application/json' \
     -d '{"clientId":"…","clientSecret":"…","signingSecret":"…"}'
   ```

   Run it again with new values to rotate them. `curl -X DELETE` on the same URL, with the same `Authorization`
   header, removes the bot and every workspace's install of it.
4. In Slack, under Event Subscriptions, press Retry.
5. Install it from `https://channels.bkper.app/slack/<your App id>/install`. To let other Slack workspaces install
   it, turn on public distribution in Slack (Manage Distribution).
