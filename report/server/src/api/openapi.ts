const REPORT_GUIDE = `Read-only financial reports of a Bkper Book, from a request in any language. Report never creates, changes or deletes anything in a Book.

## Show a person a report

When a person asks to see a report of a Book (expenses, revenue, income versus expenses, profit and loss, balances, by category, by month, …), call \`POST /api/v1/books/{bookId}/report\` with:

\`\`\`json
{ "prompt": "<the person's request, in their own words and language>", "format": "html" }
\`\`\`

and give them the returned file as it is: one self-contained, interactive HTML report (the answer with its comparison to the previous period, a chart with small previews of every other chart that fits, to switch to in place, a breakdown table whose rows open in place, and the exact Bkper query) that loads nothing and links to the same report in the Report app; shown by the Bkper Agent in a Book, that link opens it in Report in place of the Agent. With the Bkper CLI, save it and publish the file:

\`\`\`bash
bkper app api request report /api/v1/books/<bookId>/report -d '{"prompt":"show my expenses by category this year","format":"html"}' > report.html
\`\`\`

Prefer this to computing balances yourself: numbers are computed by deterministic code from the Book's balances, the same way Bkper shows them. Send \`format: spec\` (the default) instead to read the report as JSON, for example to answer with its numbers in words.

## What a request can ask

- One top-level (root) group of the Book, such as Expenses or Assets, broken down into its subgroups and Accounts; or income versus expenses (the net result). Not a single subgroup or Account: ask for its root group and the breakdown includes it.
- A period in whole months: this or last month, quarter or year, year to date, the last 12 months, all time, a year, a quarter or a month, or today. Without one: activity this year, balances today, or the last year with movements in Books with old data.
- By month, or a breakdown, a trend or a total.
- A chart, when the person names one: a pie or donut, bars, a line, an area, stacked by month, versus the previous period, a bridge (waterfall) or no chart. Keep it in the prompt as they said it. A chart that does not fit the numbers (such as a pie with a part below zero) is not drawn: the report shows the closest chart that fits and the asked-for one dimmed with why. Every chart that fits is offered as a preview in the report, so there is no need to ask again for another chart.
- \`#hashtags\`: only transactions with all of them.

Activity groups (Incoming, Outgoing) report what moved within the period; balance groups (Asset, Liability) report the balance at its end. Balances may be up to 60 seconds old.

## Saved prompts

The plural \`/api/v1/books/{bookId}/reports\` is a Book-shared shelf of original prompts, not computed reports. \`GET\` lists \`reports: [{ id, prompt }]\` and fresh \`capabilities: { list, save, remove }\`. Every known non-\`NONE\` role may list, including \`RECORDER\`; only \`OWNER\` and \`EDITOR\` may save or remove. \`POST\` accepts exactly \`{ "prompt": "…" }\` and returns \`{ report: { id, prompt } }\` (200); \`DELETE /api/v1/books/{bookId}/reports/{reportId}\` returns 204, including when absent. Both mutations are idempotent for identical input.

Save only when asked: this writes durable app metadata shared with the Book's collaborators, not Book resources or executable saved queries. Only the original text is saved (edges trimmed, 1–1000 characters), never report HTML, resolved intent, dates, amounts, inferred language or a separately selected chart. To open one against current data, send its \`prompt\` to the existing singular \`POST /report\`. Every shelf operation reads the Book's role afresh. Native saved-query role permissions apply, but its owner-plan billing restriction is not inherited. Storage visibility is eventually consistent; independent items cannot overwrite each other, while concurrent save/remove of the same item follows KV ordering. Shelf responses must not be cached. A 502 \`storage_error\` means retry the same operation; a failed write may have reached storage.

## Errors

Errors are JSON, \`{ "success": false, "error": { "code", "message" } }\`. With \`not_a_report\`, the request names nothing this Book can report: ask the person to name a group of the Book and a period, or offer the reports \`GET /api/v1/books/{bookId}/suggestions\` lists.`;

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
