/**
 * Checks that an agent who knows only this app's README and OpenAPI document calls the report
 * API as intended for a person's report request.
 *
 *     npx tsx scripts/check-agent-docs.ts --ai [--spec-url=<url>/openapi.json] [--model=<id>]
 *
 * It calls Bkper AI, so it runs only with `--ai`; without it, it only says so. By default, a
 * coding agent reviews the README and the OpenAPI texts itself instead.
 *
 * A Bkper AI language model plays a fresh agent with a shell, the Bkper CLI and a way to
 * publish files, which has already run `bkper app list -b <book>`, `bkper app get report`
 * (with the README) and `bkper app api spec report` (the OpenAPI document of the app in this
 * folder, or the one at `--spec-url`, such as a local Worker's). For each request, in several
 * languages, it answers the commands it would run and the files it would publish; `judgePlan`
 * checks them. Nothing runs and no Book is read. Calls use your `bkper auth token` and are
 * labelled `bkper-ai-source: report-docs-check`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { openApiDocumentConfig } from '../server/src/api/openapi';
import app from '../server/src/index';
import { judgePlan, type AgentPlan } from './agent-docs/plan';
import { answerText } from './translate/translation';

const ENDPOINT = 'https://ai.bkper.app/v1/responses';
const SOURCE_HEADER = 'report-docs-check';
const TIMEOUT_MS = 120_000;
const BOOK_ID = 'agtzfmJrcGVyLWhyZHITCxIGTGVkZ2VyGICAgIOLzLQKDA';

/** A person's report requests, in several languages, as they would type them to an agent. */
const REQUESTS = [
    'show my expenses by category this year',
    'quanto gastei por mês no ano passado?',
    '¿cuál fue mi resultado neto este trimestre comparado con el anterior?',
    '今年の収入の内訳を見せて',
];

const { values: args } = parseArgs({
    options: {
        ai: { type: 'boolean', default: false },
        'spec-url': { type: 'string' },
        model: { type: 'string', default: 'claude-sonnet' },
    },
});

if (!args.ai) {
    console.error(
        'This check asks a Bkper AI language model: run it with --ai to call Bkper AI.\n' +
            'Without it, review README.md, bkper.yaml and server/src/api/ yourself.'
    );
    process.exit(2);
}

const root = new URL('..', import.meta.url);
const readme = readFileSync(new URL('README.md', root), 'utf8');
const listing = appListing(readFileSync(new URL('bkper.yaml', root), 'utf8'));
const spec = args['spec-url']
    ? ((await (await fetch(args['spec-url'])).json()) as unknown)
    : app.getOpenAPIDocument(openApiDocumentConfig);
const token = execFileSync('bkper', ['auth', 'token'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
}).trim();

const instructions = `You are an AI agent helping a person with their Bkper Books. You work in a sandbox with a shell and the Bkper CLI, signed in as the person, and you can publish files from the sandbox to the person's chat. The person's current Book has id ${BOOK_ID}.

You already ran these commands:

$ bkper app list -b ${BOOK_ID}
${JSON.stringify({ items: [listing] })}

$ bkper app get report
${JSON.stringify({ ...listing, readmeMd: readme })}

$ bkper app api spec report
${JSON.stringify(spec)}

For the person's message, answer with the exact shell commands you would run next, in order, and the paths of the files you would publish to the person, if any.`;

const results = await Promise.all(
    REQUESTS.map(async request => {
        const plan = await askAgent(request);
        return { request, plan, problems: judgePlan(plan, BOOK_ID, request) };
    })
);
for (const { request, plan, problems } of results) {
    console.log(`\n${problems.length ? 'FAIL' : 'PASS'}  ${request}`);
    for (const command of plan.commands) console.log(`  $ ${command}`);
    console.log(`  publish: ${plan.publish.join(', ') || '(nothing)'}`);
    for (const problem of problems) console.log(`  ✗ ${problem}`);
}
const passed = results.filter(result => result.problems.length === 0).length;
console.log(`\n${passed}/${results.length} passed with ${args.model}.`);
process.exit(passed === results.length ? 0 : 1);

async function askAgent(request: string): Promise<AgentPlan> {
    const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'bkper-ai-source': SOURCE_HEADER,
        },
        body: JSON.stringify({
            model: args.model,
            store: false,
            input: [
                { role: 'system', content: instructions },
                { role: 'user', content: request },
            ],
            text: {
                format: {
                    type: 'json_schema',
                    name: 'plan',
                    strict: true,
                    schema: {
                        type: 'object',
                        properties: {
                            commands: { type: 'array', items: { type: 'string' } },
                            publish: { type: 'array', items: { type: 'string' } },
                        },
                        required: ['commands', 'publish'],
                        additionalProperties: false,
                    },
                },
            },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body: unknown = await response.json().catch(() => undefined);
    const text = answerText(body);
    if (!response.ok || text === undefined) {
        throw new Error(`Bkper AI answered ${response.status}: ${JSON.stringify(body)}`);
    }
    return JSON.parse(text) as AgentPlan;
}

/** The listing fields `bkper app list` shows, from the top-level scalars of `bkper.yaml`. */
function appListing(yaml: string): Record<string, string> {
    const keys = ['id', 'name', 'description', 'website', 'ownerName', 'menuUrl', 'menuText'];
    const fields: Record<string, string> = {};
    for (const line of yaml.split('\n')) {
        const match = /^(\w+): (.+)$/.exec(line);
        if (match && keys.includes(match[1])) fields[match[1]] = match[2].replace(/^'|'$/g, '');
    }
    return fields;
}
