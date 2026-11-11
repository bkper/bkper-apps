# Report App

<video src="https://report.bkper.app/images/report-typing.mp4" poster="https://report.bkper.app/images/report-typing.jpg" width="800" autoplay loop muted playsinline aria-label="Typing a question in Report App: each report appears about a second after the last key"><a href="https://report.bkper.app/images/report-typing.mp4"><img src="https://report.bkper.app/images/report-typing.jpg" width="800" alt="Report App showing Net Income this year, with charts to switch to and suggested reports"></a></video>

Ask about your Book in your own words, in any language, and see the report as you type.

Every number is a balance from Bkper. AI only reads your request, never computes amounts. Report never changes your transactions.

## Get started

1. Open a Book and install **Report App** from _Automations > Apps_.
2. Choose **Open Report** in the Book menu.
3. Type what you want to know. The report appears as you type.

## What you can ask

| You type | You get |
| --- | --- |
| expenses by category this year | This year's expenses, split by category |
| profit last year | Last year's net result |
| receitas por mês em 2025 | Revenue month by month in 2025 |
| cash today | Your cash balance today |
| revenue last year vs 2023 | The two years side by side |
| #travel expenses this year | Only transactions tagged `#travel` |
| Food versus Rent by month | Food and Rent side by side |

Tips:

- **Names** — type a group or account name and pick it from the list.
- **Charts** — say "as a donut", "as a line" or "just the numbers". You can also click a preview beside the title.
- **Periods** — months, quarters, years, year to date, the last 12 months, or today.

## It follows your Book

Click a group or account in the Book's sidebar, or search the Book, and Report shows the same numbers as the Book.

## Save requests

Click **Save** to keep a request above the input for everyone in the Book. It saves the question, not the numbers, so it always shows current data.

## Need something else?

Click **Custom report**, the last chip above the input. It opens Bkper Agent with a draft you finish in your own words.

If your Book isn't organized for reports yet, Report says why. Owners and editors can ask Bkper Agent to fix it in one click.

## Good to know

- New transactions can take up to two minutes to show.
- Typed requests use your Bkper AI allowance.
- Anyone who can view the Book can use Report.

<details>
<summary><strong>API access</strong></summary>

```text
Production: https://report.bkper.app
Preview:    https://report-preview.bkper.app
OpenAPI:    https://report.bkper.app/openapi.json
```

Agents: the OpenAPI document explains how to show a person a report in one call.

```bash
curl -X POST \
  -H "Authorization: Bearer $(bkper auth token)" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "expenses by category this year", "format": "html"}' \
  "https://report.bkper.app/api/v1/books/<bookId>/report" > report.html
```

</details>
