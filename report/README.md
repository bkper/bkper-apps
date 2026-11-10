# Report

Type what you want to know about your Book, in your own language, and see the report as you type: the answer and its change from the previous period (or from the same period a year earlier, when you ask for it), a chart, the groups and Accounts behind it, and the exact Bkper query.

> **Read-only, with every number from Bkper.** Every amount is a balance Bkper calculates for one group or Account, but for one labelled exception (see [The net result](#the-net-result)); numbers never come from AI. Saving a request writes app metadata, never transactions, balances or the Book's saved queries.

> **For agents.** To show a person a report, make one call with their request in their own words and publish the file as it is: `bkper app api request report /api/v1/books/<bookId>/report -d '{"prompt":"<their request>","format":"html"}' > report.html`. Its amounts are Bkper balances read by code and it shows the query it read, so don't query or re-check them yourself.

## How to use it

1. Open a Book in Bkper and, the first time, install Report from _Automations > Apps_.
2. Choose **Report** from the Book menu.
3. Report opens with the first request saved for the Book, else the first suggested report, its words selected: start typing to ask your own instead. There is no button: the report appears as you type. Press **Enter** to ask at once.

Report speaks the language you chose in Bkper, else your browser's. A typed request gets its report in the language you typed it in. The page's address keeps your report, so reloading, bookmarking or sharing the link with someone who can view the Book opens it again with the latest balances.

## What you can ask

Write the way you would ask a colleague, in any language:

| You type | You get |
| --- | --- |
| expenses by category this year | This year's expenses, by their groups and Accounts |
| profit last year | Last year's net result, and the groups that make it |
| receitas por mês em 2025 | Revenue of each month of 2025 |
| ¿cuánto tengo en mis cuentas hoy? | Your asset balances today, by Account |
| 去年第四季度的支出 | Expenses in the fourth quarter of last year |
| revenue last year vs 2023 | Last year's revenue beside 2023's |
| expenses Q3 vs Q1 | The third quarter's expenses beside the first quarter's |
| #travel expenses this year | This year's expenses on transactions tagged `#travel` |
| Food last month | Your _Food_ group or Account alone |
| Food versus Rent by month | _Food_ and _Rent_ side by side, month by month, never added up |
| despesas por categoria em pizza | This year's expenses as a pie chart |

- **Names.** Name any group or Account as your Book writes it (case and accents aside). As you type two letters, Report suggests up to five names; press **Tab** or click to take one. Name up to six to see them side by side, all balances (assets, liabilities) or all activity (income, expenses). For their total, add a group that holds them in Bkper and ask for it.
- **No name?** Report reports the top-level group your request is about, such as Expenses or Assets, or income versus expenses.
- **Periods** in whole months: this or last month, quarter or year, year to date, the last 12 months, all time, a specific month, quarter or year, or today (balances as of today; activity today reads this month). A current period runs through the end of this month, and a report names what it read: a whole year, quarter or month by its name (_2025_, _Q3 2024_), the months so far as a range (_Jan – Nov 2026 vs. Jan – Nov 2025_). Without one, activity for this year and balances for today, or the last year with movements in an older Book. A period that hasn't started, such as next month, has no report yet. No custom ranges such as a single week.
- **Comparisons.** A report compares with the previous period, or with the same period a year earlier when you ask. Name any other period of the same kind to compare with it: _revenue last year vs 2023_, _Q3 vs Q1_, _January vs January 2019_. A comparison that can't be made, such as a month against a year, or two periods that overlap, shows the previous period instead and says so.
- **A hashtag** keeps only the transactions that have it. One per report, as Bkper filters balances by one: with several, Report reads the first.

### The net result

The net result comes from a group in your Book that holds both your income and your expense groups, such as _Profit and loss_. Without one, if each top-level group holds only income or only expenses and no Account is in two of them, Report subtracts expenses from income and marks the result **Calculated by Report**. Otherwise, add such a group in Bkper and ask again.

## Charts

Report picks the chart that fits. To start with another, name it in your request:

| Ask for | You see |
| --- | --- |
| a pie, a donut | Each part's share of the total |
| bars, a line | Amounts month by month, or the parts, largest first |
| stacked by month | The parts piled up, month by month |
| an area chart | Amounts over time, as a filled area |
| versus last month, versus last year, versus 2023 | Each part beside the period compared with |
| versus January last year, year over year | Each part beside the same period a year earlier |
| just the numbers | The answer and the table, without a chart |

A chart that cannot show your numbers honestly is not drawn. It appears dimmed among the previews with the reason, such as _A pie can't show Taxes (-186.74)_, and the closest chart that fits is shown instead. For example, a pie needs two or more positive parts that make up the total, and side-by-side names never get a chart that suggests a total. Report never draws a bridge (waterfall), because its bars would be sums Report makes itself.

## Save a request for the Book

Click **Save** to add the request behind the report on screen to the end of the row above the input, shared with everyone in the Book. You save the **question, not the numbers**: opening it builds the report from current data, and _last month_ always means the last month. The first request in the row is the one Report opens with. Owners and editors can save requests, drag them along the row to reorder them (on a phone, touch and hold one first), and move or remove them from each one's **⋯** menu; viewers and posters can open them.

## When a Book has no report

Some Books are not organized for reports yet. Report then says why instead of showing one:

| The Book | Shown |
| --- | --- |
| Has no transactions yet | When Report opens |
| Has no groups, or most Accounts with transactions are in no group | When Report opens |
| Has no group that holds both income and expenses, or its income and expense groups share Accounts | When you ask for the net result |
| Has a group that mixes balances (assets, liabilities) with activity (income, expenses) | When you ask for that group |

Owners and editors get **Organize with Agent**: it opens the Bkper Agent in the Book with a request ready in its input, in your language, naming the groups involved and asking to change groups only, never transactions. The Agent sends nothing until you do, so read it, change it if you like, and send it. A Book with no transactions gets **Get started with Agent** instead. Everyone else is told to ask the Book's owner.

## Good to know

- **Up to two minutes behind.** Report keeps balances and reports for up to a minute each, so a transaction posted in the last two minutes may not show yet.
- **Bkper AI allowance.** Typed requests and saved requests use it, including the saved request Report opens with. Suggested reports use it once each time your Book's groups change, to choose which matter most; names never do.
- **What you share.** Report sends your request to Bkper AI to read it. A saved request is visible to all the Book's collaborators, and a report link contains its request.
- **Who can use it.** Anyone who can view the Book's balances.

## Reports in Bkper Agent

Ask the Bkper Agent for a report in your own words, such as _show my expenses by category this year_. It asks Report for you and shows the same interactive report, with an **Open in Report** link. In a Book where Report is installed, the link opens Report in place of the Agent, where you can keep asking; elsewhere, in a new tab.

<details data-toc>
<summary><strong>API access</strong></summary>

The web app and the Bkper Agent use the same authenticated API. Every call checks the person's Book permissions. Reports only read the Book.

```text
Production: https://report.bkper.app
Preview:    https://report-preview.bkper.app
OpenAPI:    https://report.bkper.app/openapi.json
```

| Operation | Route | Effect |
| --- | --- | --- |
| Build a report | `POST /api/v1/books/{bookId}/report` | One interactive HTML file (`"format": "html"`), or the JSON Report's web client renders (default). Read-only |
| Suggest reports | `GET /api/v1/books/{bookId}/suggestions` | Up to three reports the Book can have, as requests, the main one first |
| List names | `GET /api/v1/books/{bookId}/names` | The Book's group and Account names |
| List saved requests | `GET /api/v1/books/{bookId}/prompts` | The Book's shared requests in their order, and what the person may do with them |
| Save a request | `POST /api/v1/books/{bookId}/prompts` | Owner or editor. Writes app metadata only |
| Remove a request | `DELETE /api/v1/books/{bookId}/prompts/{promptId}` | Owner or editor |
| Move a request | `PUT /api/v1/books/{bookId}/prompts/{promptId}/position` | Owner or editor. `{ "before": id }`, or `null` for the end |

To show a person a report, send their request in their own words and language, and give them the returned file as it is:

```bash
bkper app api request report /api/v1/books/<bookId>/report \
  -d '{"prompt":"show my expenses by category this year","format":"html"}' > report.html
```

Or with any HTTP client and a Bkper OAuth bearer token:

```bash
curl -X POST \
  -H "Authorization: Bearer $(bkper auth token)" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "expenses by category this year", "format": "html"}' \
  "https://report.bkper.app/api/v1/books/<bookId>/report" > report.html
```

To open a saved request with current data, send its `prompt` to `/report`. A suggestion, sent as `prompt` exactly as listed and in the same `language`, builds its report without AI. The JSON's `text` is the report's own short text in its language: send it as `prompt` to ask for the same report again.

See the [OpenAPI specification](https://report.bkper.app/openapi.json) for every field, error and what to do about it.

</details>
