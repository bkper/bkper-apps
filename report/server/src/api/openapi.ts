const REPORT_GUIDE = `Read-only financial reports of a Bkper Book, from a request in any language or a Bkper query. Report never creates, changes or deletes anything in a Book.

## Show a person a report

When a person asks to see a report of a Book (expenses, revenue, income versus expenses, profit and loss, balances, by category, by month, …), unless they ask for a custom report (see Custom reports), call \`POST /api/v1/books/{bookId}/report\` with:

\`\`\`json
{ "prompt": "<the person's request, in their own words and language>", "format": "html" }
\`\`\`

and give them the returned file as it is: one self-contained, interactive HTML report (the answer with its comparison to the previous period, a chart with small previews of every other chart that fits, to switch to in place, a breakdown table whose rows open in place, and its source: the period and the exact Bkper query) that loads nothing and links to the same report in the Report app; shown by the Bkper Agent in a Book, that link opens it in Report in place of the Agent. With the Bkper CLI, save it and publish the file:

\`\`\`bash
bkper app api request report /api/v1/books/<bookId>/report -d '{"prompt":"show my expenses by category this year","format":"html"}' > report.html
\`\`\`

This one call is the whole task, and the deterministic route to the report: every amount is a Bkper balance of one group or Account, as Bkper shows it, read by code, never by AI; Report adds nothing up, but for one labelled case below, and the file shows the exact Bkper query it read, for anyone to audit. So do not compute or query the balances yourself, do not ask for \`format: spec\` first, and do not re-check the amounts or open the file: publish it and answer in a line, as the report speaks for itself. \`format: spec\` (the default) is the JSON Report's own web client renders; showing a report never needs it.

## Custom reports

A request for a custom report, or one that says it is not for the Report app, is not for Report: build that report yourself from the Book's Bkper balances (with the Bkper CLI or API), and do not call \`POST /api/v1/books/{bookId}/report\`. Report's own **Custom report** chip opens the Bkper Agent with such a request started, in the person's language, such as "Create a custom report, without using the Report app, that …". Every other report request goes to Report as above.

## What a request can ask

- One top-level (root) group of the Book, such as Expenses or Assets, broken down into the subgroups and Accounts Bkper returns; or income versus expenses (the net result).
- A subgroup or an Account, by its name as the Book writes it (case and accents aside), such as "Food this year"; or several, such as "Food and Rent by month" or "Food versus Rent": each with its own balance side by side, never added up. They must all be balances (Asset, Liability) or all activity (Incoming, Outgoing), else \`mixed_targets\`. Keep the names in the prompt as the person wrote them. A request that writes no name of the Book reports the subgroup or Account it means, else the root group it is about; groups the Book hides only when named.
- The net result comes from the group that combines the Book's Incoming and Outgoing groups, as Bkper calculates it. Without one, when each activity root is only Incoming or only Outgoing and no two share an Account, Report subtracts the Outgoing roots from the Incoming roots and labels the result "Calculated by Report". Otherwise the Book has no net result (\`no_net_result\`) until income and expenses meet in one top-level group.
- A period in whole months: this or last month, quarter or year, the year before last, year to date, the last 12 months, all time, any year, quarter or month the person writes, or today. Without one: activity this year, balances today, or the last year with movements in Books with old data. One that has not started, such as next month, is \`future_period\`.
- What the period is compared with: the previous period, the same period a year earlier, or any other period of the same kind the prompt names (last year vs 2023, Q3 vs Q1). A comparison that cannot be made, such as a month against a year, compares with the previous period instead and says so in the report.
- By month, or a breakdown, a trend or a total.
- A chart, when the person names one: a donut (a pie is drawn as one), bars, a line, an area, stacked by month, versus the previous period, or no chart. Keep it in the prompt as they said it. A line for activity, or bars for balances, replaces the usual chart by month. A chart that does not fit the numbers (such as a donut with a part below zero, or a bridge, which Report never draws) is not drawn: the report shows the closest chart that fits and a line under its title says why. Every chart that fits is offered as a preview beside the report's title (at most six), so there is no need to ask again for another chart.
- A \`#hashtag\`: only transactions with it. One per report, as Bkper filters balances by one; a prompt's first hashtag is read and the others are left out.

Activity groups (Incoming, Outgoing) report what moved within the period; balance groups (Asset, Liability) report the balance at its end; a balance today, or at the end of a month, also shows a line of the 12 month-ends ending then. Balances may be up to 60 seconds old.

## Report a Bkper query

To report what a Book shows, send its Bkper query as \`query\` instead of \`prompt\`; a person's words always go as \`prompt\`. A \`prompt\` with a \`group:\`, \`account:\` or \`acc:\` term is read as a query too. A query is read exactly as sent, with no AI: every amount is Bkper's balance for that very query, as the Book's sidebar shows it, future-dated transactions included, and nothing in it is rewritten or cut off. Its \`group:\` and \`account:\` names are what the report is of (several side by side, up to six); its period is the days Bkper read (\`after:01/01/2026 before:01/01/2027\` is Jan 1 – Dec 31, 2026; \`before:\` alone, a balance as of its last day; no dates, all time). Months for charts come from the same query by month, and the comparison from the same query with its dates moved to the period before; each is left out unless it reads as the query does. The report's \`text\` is the query, which sent back as \`prompt\` is read as that query. A query that names no group or Account Bkper finds answers 422 \`query_not_a_report\`.

## Saved prompts

\`/api/v1/books/{bookId}/prompts\` is a Book-shared shelf of original prompts, not computed reports. \`GET\` lists \`prompts: [{ id, prompt }]\` in the shelf's order and fresh \`capabilities: { list, save, remove, move }\`. Every known non-\`NONE\` role may list, including \`RECORDER\`; only \`OWNER\` and \`EDITOR\` may save, remove or move. \`POST\` accepts exactly \`{ "prompt": "…" }\` and returns the saved \`{ id, prompt }\` (200), a new prompt last and one saved again in its place; \`DELETE /api/v1/books/{bookId}/prompts/{promptId}\` returns 204, including when absent; \`PUT /api/v1/books/{bookId}/prompts/{promptId}/position\` accepts exactly \`{ "before": "<id>" | null }\` (\`null\`: the end) and returns the whole shelf in its new order, as \`GET\` does (404 \`prompt_not_found\`, 409 \`shelf_changed\` when \`before\` is gone: list again). All three are idempotent for identical input.

Save only when asked: this writes durable app metadata shared with the Book's collaborators, not Book resources or executable saved queries. Only the original text is saved (edges trimmed, 1–1000 characters), never report HTML, resolved intent, dates, amounts, inferred language or a separately selected chart. To open one against current data, send its \`prompt\` to the existing singular \`POST /report\`. Every shelf operation reads the Book's role afresh. Native saved-query role permissions apply, but its owner-plan billing restriction is not inherited. Storage visibility is eventually consistent; independent items cannot overwrite each other, while concurrent save/remove of the same item follows KV ordering. Shelf responses must not be cached. A 502 \`storage_error\` means retry the same operation; a failed write may have reached storage.

## Errors

Errors are JSON, \`{ "success": false, "error": { "code", "message" } }\`. With \`not_a_report\`, the request names nothing this Book can report: ask the person to name a group of the Book and a period, or offer the reports it carries as \`suggestions\` (those \`GET /api/v1/books/{bookId}/suggestions\` lists): each is a request, built with no AI when sent as \`prompt\` exactly as listed, in the same \`language\`. Four errors are problems of the Book itself, with a \`problem\` object naming what is involved: \`empty_book\` (no transactions yet), \`nothing_to_report\` (no groups, or most Accounts with transactions in no group), \`no_net_result\` (no group combines its income and expense groups, or they share Accounts) and \`mixed_group\` (the group asked for mixes balances with activity). \`GET /api/v1/books/{bookId}/suggestions\` tells the first two as \`problem\` when the Book opens. Report never changes the Book: if the person is its OWNER or EDITOR (\`problem.canOrganize\`), offer to organize its groups for them (for \`empty_book\`, to help them get started), changing groups only, never transactions, and only once they agree; otherwise, tell them to ask the Book's owner.`;

export const openApiDocumentConfig = {
    openapi: '3.0.0' as const,
    info: {
        title: 'Report API',
        version: '1.0.0',
        description: REPORT_GUIDE,
    },
    servers: [
        { url: 'https://report.bkper.app', description: 'Production' },
        { url: 'https://report-preview.bkper.app', description: 'Preview' },
        { url: 'http://localhost:8809', description: 'Local Worker' },
    ],
    tags: [
        {
            name: 'Reports',
            description: 'Financial reports of a Book, read-only, from a request in any language.',
        },
        {
            name: 'Saved prompts',
            description:
                'Book-shared original prompts in durable app metadata, with fresh Book role authorization. No computed reports or Book resources are stored or changed.',
        },
        { name: 'API', description: 'API health.' },
    ],
};
