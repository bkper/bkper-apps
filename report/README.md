# Report

Type what you want to know about your Book, in your own language, and see the report as you type.

> **Your financial data stays unchanged.** Report only reads your Book. Saving a request writes app metadata, never transactions, balances or the Book's saved queries.

## What it does

Report turns a short request, such as _expenses by category this year_, into a financial report of your Book:

- **The answer first**: the amount, the same amount in the previous comparable period, and the change.
- **One chart** that fits the question: bars by month, a line for balances over time, ranked bars or a donut for a breakdown. Or the chart you ask for (see [Charts](#charts)). Above it, small previews of every chart that fits the same numbers: click one to see it instead. The previews stay in place when the chart's height changes.
- **A breakdown table** of the group's subgroups and Accounts, sorted by size, with each one's share and change. Open a row to see what is inside it; the chart highlights it.
- **The source**: the exact Bkper query, the period and when the balances were read, with a link to open the same query in your Book.

Every number is computed from your Book's balances by fixed rules, never by AI. AI only recognizes what your request is about: the group, the period, and whether you ask about months, parts, an earlier period or a step-by-step bridge, or name a chart. Fixed rules then decide the report and its chart.

## How to use it

1. Open a Book in Bkper and, the first time, install Report from _Automations > Apps_.
2. Choose **Report** from the Book menu.
3. Pick one of the suggested reports, or type your own request. There is no button: the report appears and updates as you type. Press **Enter** to ask at once.

The address of the page keeps your report, so you can bookmark it or send its link to someone who also has access to the Book. In a Book, the Book's own address keeps it, so reloading the Book, or coming back to it, opens the same report. Whoever opens the link sees the report with the Book's latest balances.

## Save a request for everyone in the Book

After your report appears, click **Save** once. Its original request joins the row above the input, shared with the Book's collaborators. You save the **question, not a screenshot**: no amounts, resolved dates or separately selected chart are saved.

Click a saved request to build it again from current data, even if you have just opened it. Relative dates roll forward: _expenses last month_ reads October when opened in November, and November when opened in December. Balances may still be up to a minute behind. Each saved click understands the request again and uses your Bkper AI allowance.

Owners and editors can save requests and remove any saved request. Viewers and posters can open shared requests but cannot change the shelf. Recorders can see the saved requests, but their role does not permit viewing financial reports. Removing a request does not delete financial data or a report you already opened. Shared changes can take a moment to appear for another person; reopen Report to reload the shelf.

Save uses the request that produced the report on screen, not a later draft you are typing. Reports restored from a report link or opened from a suggestion have no original typed request to save; type your own request to save one. To keep a chart choice in the saved request, name the chart in your words.

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

Report picks the chart that fits your request, and shows every chart that fits the same numbers as small previews above it. Click a preview, or move to it with the arrow keys and press **Enter**, to see the report as that chart at once. The report's address keeps the chart you chose, so its link, reloading it or coming back to it shows that chart.

To start with another chart, name it in your request, in any language:

| Ask for | You see |
| --- | --- |
| a pie, a donut | Each part's share of the total, as slices |
| bars, a line | The amounts month by month; or bars of the parts, largest first |
| stacked by month | The parts piled on each other, month by month |
| an area chart | The amounts over time, as a filled area |
| versus last year, compared with the month before | Each part in this period beside the previous one |
| a bridge, a waterfall | From a starting amount, step by step, to the final one: from income, through each expense, to the net result; or from the balance at the start of the period, through each part's change, to the balance at its end |
| just the numbers, no chart | The answer and the breakdown table, without a chart |

### When a chart is dimmed

The breakdown table always stays below the chart, so it has no preview card. You can still ask for just the numbers, without a chart; any chart previews remain available if you want to add one.

A chart you ask for that does not fit your numbers is not drawn: it shows first among the previews, dimmed, with the reason, such as _A pie can't show Taxes (-186.74)_. The report shows the closest chart that fits instead. A chart fits when:

- **A pie** has two or more parts, all positive and of one kind, so not income versus expenses. **A donut** also has at most six.
- **Stacked** and **area** charts have a period of two or more months. Stacked also needs two or more parts, and does not fit income versus expenses.
- **A comparison** has a previous period, so not all time.
- **A bridge** is income versus expenses, or balances such as assets, except over all time. It does not fit a single activity group, such as expenses alone, or amounts that did not change.

Charts that do not fit and that you did not ask for are simply not offered. A report with nothing to chart shows only its numbers.

## Good to know

- **Top-level groups only.** A report starts from a top-level group, not from a single subgroup or Account. Ask for the group that holds it and open its row in the breakdown.
- **Periods in whole months.** Report understands months, quarters and years: this or last month, quarter or year, year to date, the last 12 months, all time, a specific month, quarter or year, or today. It does not report custom date ranges such as a single week.
- **Hashtags.** Add `#hashtags` to your request to include only the transactions that have all of them.
- **Up to a minute behind.** Report keeps your Book's balances for up to 60 seconds to answer quickly, so a transaction you posted in the last minute may not show yet.
- **You choose what to share.** Report sends your request to Bkper AI to understand it. Saving explicitly keeps its original text in the Book's shared shelf, visible to all its collaborators; do not save text you do not want to share with them. Typed requests and saved-request clicks use your Bkper AI allowance; suggested reports do not. A report's link also contains its request, so anyone you share the link with sees what you typed.
- **Who can use it.** Anyone who can view the Book can see its reports.

## Reports in Bkper Agent

Ask the Bkper Agent for a report in your own words, such as _show my expenses by category this year_. It asks Report on your behalf and shows you the same interactive report, with its chart previews and an **Open in Report** link. Choosing another chart there changes nothing in your Book; the link then opens the report as that chart.

When the Agent is open in Bkper, such as in your Book, the link opens the report in Report in the Book, in place of the Agent, where you can keep asking. Report needs to be installed in that Book. Where the Agent cannot open it there, such as when the Agent is opened on its own, the link opens Report in a new tab.

## API access

Report exposes an authenticated API, used by the web app and the Bkper Agent, for scripts and integrations. Financial reporting only reads Books; saved requests write only app metadata.

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

The shared shelf uses `GET /api/v1/books/<bookId>/reports` to list, `POST` on the same path with `{ "prompt": "your original request" }` to save, and `DELETE /api/v1/books/<bookId>/reports/<id>` to remove. Book permissions are checked on every call. To execute a saved request, send its `prompt` to the singular `/report` endpoint above; do not reuse a previously resolved intent if relative dates must roll forward.

## Learn more

- [Bkper Help Center](https://bkper.com/docs)
