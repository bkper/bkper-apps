# Bkper for Slack

Ask about your Books and work on them without leaving Slack. Tag `@bkper` in a thread, or message it directly, and
[Bkper Agent](https://bkper.com/docs/ai/bkper-agent) answers right there, as you: with your own Bkper account and your
access to Books.

Bkper remains the source of truth. Balances and reports come from your Books, and Bkper enforces each person's Book
sharing on every read and every change.

> Bkper Agent is in beta and open to every Bkper account. Expect changes.

## Add it to Slack

1. Open [Add to Slack](https://channels.bkper.app/slack/bkper-slack/install). Anyone your workspace lets install apps
   can add it. Installing needs no Bkper account and grants nothing in Bkper.
2. Invite it to a channel with `/invite @bkper` and tag it, or message it directly.
3. The first time you use it, it asks you, and only you, to connect your Bkper account: sign in with Slack, then with
   Bkper, and confirm. Everyone connects their own account the same way.

## Get your first useful result

Start with a question. Replace the Book, names and dates with your own.

```text
@bkper what is the cash balance in Acme Corp today?
```

```text
@bkper what were our five biggest expenses last month?
```

```text
@bkper has invoice 1043 from Northwind been paid?
```

In a direct message, drop a receipt or a bank statement and ask:

```text
Record this in Acme Corp.
```

Ask for a file, and it is posted in the thread below the answer:

```text
@bkper export Q3 expenses by Group as a CSV.
```

## How it works

```text
Slack → Bkper for Slack → Bkper Agent → Bkper → your Books
```

- **It reads the thread.** Tag it in a conversation and it sees what was said since you last asked, so "and for Q3?"
  makes sense.
- **Each answer opens with whose access it uses**, such as "As @ana", while it is still working.
- **Reply without tagging it** while it is talking with you in a thread. Once someone else posts, or you mention
  someone, tag `@bkper` again.
- **Everyone acts as themselves.** When two people ask in the same thread, each answer comes from that person's own
  access to Books.
- **Files both ways.** Receipts, statements and spreadsheets you share go to Bkper Agent; reports and exports it
  publishes come back as files in the thread.
- **Usage** counts against the monthly [Bkper AI allowance](https://bkper.com/docs/ai/models) of the person who asked,
  included with their plan.

## What to know

- **In a channel, everyone in it sees the answers**, including people without access to that Book: you are sharing
  them. For anything private, message the bot directly. Direct messages are seen only by you.
- **It asks before changing a Book**, and only the person who asked can confirm. Changes show in Book history as
  yours, via Bkper for Slack.
- **Without access to a Book, it says so.** It never uses anyone else's access, even when their answers are in the
  same thread.
- **Slack never sees your Bkper credentials**, and the bot cannot do anything your own Bkper account cannot.
- **Guests and people from other organizations** in shared channels use it the same way, with their own Bkper
  accounts.

## Safety checklist

- Start with questions before asking for changes.
- Name the Book you mean.
- Ask in a direct message for anything personal or confidential.
- Read each proposed change before you confirm it.
- To make sure it cannot change a Book for someone, share that Book with them as View only.

## Disconnect or remove

- **Disconnect** your Bkper account any time from the bot's Home tab in Slack. It then stops acting as you.
- **Uninstall** the app from Slack to remove it from the workspace, with everyone's connections.
