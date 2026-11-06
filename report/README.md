# Report

Type what you want to know about your Book, in your own language, and see the report as you type.

> **Report only reads your Book.** It never creates, changes or deletes anything in it.

## What it does

Report turns a short request, such as _expenses by category this year_, into a financial report of your Book:

- **The answer first**: the amount, the same amount in the previous comparable period, and the change.
- **One chart** that fits the question: bars by month, a line for balances over time, ranked bars or a donut for a breakdown. Or the chart you ask for (see [Charts](#charts)).
- **A breakdown table** of the group's subgroups and Accounts, sorted by size, with each one's share and change. Open a row to see what is inside it; the chart highlights it.
- **The source**: the exact Bkper query, the period and when the balances were read, with a link to open the same query in your Book.

Every number is computed from your Book's balances by fixed rules, never by AI. AI only reads your request to choose which group, period, view and chart you mean.

## How to use it

1. Open a Book in Bkper and, the first time, install Report from _Automations > Apps_.
2. Choose **Report** from the Book menu.
3. Pick one of the suggested reports, or type your own request. There is no button: the report appears and updates as you type. Press **Enter** to ask at once.

The address of the page keeps your report, so you can bookmark it or send its link to someone who also has access to the Book. In a Book, the Book's own address keeps it, so reloading the Book, or coming back to it, opens the same report. Whoever opens the link sees the report with the Book's latest balances.

## What you can ask

Write the way you would ask a colleague, in any language:

| You type | You get |
| --- | --- |
| expenses by category this year | This year's expenses, broken down by their groups and Accounts |
| income versus expenses last year | Last year's net result: incoming, outgoing and what is left |
| receitas por mês em 2025 | Revenue of each month of 2025 |
| ¿cuánto tengo en mis cuentas hoy? | Your asset balances today, by Account |
| 去年第四季度的支出 | Expenses in the fourth quarter of last year |
| dettes à la fin de 2024 | What you owed at the end of 2024 |
| #travel expenses this year | This year's expenses on transactions tagged `#travel` |
| despesas por categoria em pizza | This year's expenses as a pie chart |
| bridge from revenue to profit last year | Last year's net result as a waterfall, from income through each expense |

A report always starts from one of the **top-level groups** of your Book, such as Expenses or Assets, or from **income versus expenses** (the net result). Activity groups (incoming and outgoing) show what moved within the period; balance groups (assets and liabilities) show the balance at the end of it.

When your request names no period, Report shows activity for this year and balances for today. If your Book has no movements in that time, it shows the last year that has them.

## Charts

Report picks the chart that fits your request. To see another, name it in your request, in any language:

| Ask for | You see |
| --- | --- |
| a pie | Each part's share of the total, as slices |
| stacked by month | The parts piled on each other, month by month |
| an area chart | The amounts over time, as a filled area |
| versus last year, compared with the month before | Each part in this period beside the previous one |
| a bridge, a waterfall | From a starting amount, step by step, to the final one: from income, through each expense, to the net result; or from the balance at the start of the period, through each part's change, to the balance at its end |
| just the numbers, no chart | The answer and the breakdown table, without a chart |

A chart that does not fit the report shows as the chart Report would pick instead. For example:

- **A pie** needs two or more parts, all positive and of one kind, so not income versus expenses.
- **Stacked** and **area** charts need a period of two or more months. Stacked also needs two or more parts, and does not fit income versus expenses.
- **A comparison** needs a previous period, so not all time.
- **A bridge** fits income versus expenses, and balances such as assets except over all time. It does not fit a single activity group, such as expenses alone.

## Good to know

- **Top-level groups only.** A report starts from a top-level group, not from a single subgroup or Account. Ask for the group that holds it and open its row in the breakdown.
- **Periods in whole months.** Report understands months, quarters and years: this or last month, quarter or year, year to date, the last 12 months, all time, a specific month, quarter or year, or today. It does not report custom date ranges such as a single week.
- **Hashtags.** Add `#hashtags` to your request to include only the transactions that have all of them. These reports take a moment longer.
- **Up to a minute behind.** Report keeps your Book's balances for up to 60 seconds to answer quickly, so a transaction you posted in the last minute may not show yet.
- **Your requests stay private.** Report sends what you type to Bkper AI only to understand it, and keeps no copy of it. Typed requests use your Bkper AI allowance; suggested reports do not. A report's link contains its request, so anyone you share the link with sees what you typed.
- **Who can use it.** Anyone who can view the Book can see its reports.

## Reports in Bkper Agent

Ask the Bkper Agent for a report in your own words, such as _show my expenses by category this year_. It asks Report on your behalf and shows you the same interactive report, with an **Open in Report** link.

When the Agent is open in Bkper, such as in your Book, the link opens the report in Report in the Book, in place of the Agent, where you can keep asking. Report needs to be installed in that Book. Where the Agent cannot open it there, such as when the Agent is opened on its own, the link opens Report in a new tab.

## API access

Report exposes an authenticated API, used by the web app and the Bkper Agent, for scripts and integrations. It only reads Books.

```txt
Production: https://report.bkper.app
Preview:    https://report-preview.bkper.app
OpenAPI:    https://report.bkper.app/openapi.json
```

Ask for a report in any language with a Bkper OAuth bearer token. `"format": "html"` returns the report as one self-contained interactive HTML file; leave it out to get the report as JSON.

```bash
curl -X POST \
  -H "Authorization: Bearer $(bkper auth token)" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "expenses by category this year", "format": "html"}' \
  "https://report.bkper.app/api/v1/books/<bookId>/report" > report.html
```

## Learn more

- [Bkper Help Center](https://bkper.com/docs)
