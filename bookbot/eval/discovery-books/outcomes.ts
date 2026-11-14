/**
 * Measures whether users keep Bookbot's suggestions in production: reads only, never writes.
 *
 *   bun eval/discovery-books/outcomes.ts --data <dir> --before <from>,<to> [--after <from>,<to>] --out <file>
 *
 * For each Book in `<dir>/books.json`, reads the transactions dated after `--since` (default
 * 2026-08-01), groups them by creation time into the periods (ISO times, from inclusive, to
 * exclusive), and tallies the suggestions kept, changed and still drafts. Writes the per-Book
 * tallies to `<file>`, which holds client data, and prints totals and, with both periods, the
 * target check of `<dir>/production/TARGET.md`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Bkper } from 'bkper-js';

import { cliToken, mapLimit, type BookConfig } from './frozen.js';
import { installReadOnlyGuard } from './readOnly.js';
import { checkProductionTarget, tallyOutcomes, type OutcomeTally, type Period } from './score.js';

const PAGE = 1000;
const BOOKS_AT_A_TIME = 4;

function periodOf(value: string): Period {
    const [from, to] = value.split(',').map(time => Date.parse(time));
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new Error(`Not a period: ${value}. Pass <from>,<to> as ISO times.`);
    return { from, to };
}

async function readTransactions(bkper: Bkper, bookId: string, since: string): Promise<bkper.Transaction[]> {
    const book = await bkper.getBook(bookId);
    const transactions: bkper.Transaction[] = [];
    let cursor: string | undefined;
    do {
        const list = await book.listTransactions(`after:${since}`, PAGE, cursor);
        transactions.push(...list.getItems().map(transaction => transaction.json()));
        cursor = list.getItems().length === PAGE ? list.getCursor() : undefined;
    } while (cursor);
    return transactions;
}

function totals(rows: OutcomeTally[]): string {
    const sum = (key: 'created' | 'suggestions' | 'kept' | 'changed' | 'drafts') => rows.reduce((total, row) => total + row[key], 0);
    const posted = sum('kept') + sum('changed');
    return `${sum('created')} created, ${sum('suggestions')} suggestions, ${sum('kept')} kept, ${sum('changed')} changed `
        + `(${posted ? (100 * sum('changed') / posted).toFixed(1) : '0.0'}%), ${sum('drafts')} drafts`;
}

async function main(): Promise<void> {
    const { values } = parseArgs({ options: { data: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' }, since: { type: 'string' }, out: { type: 'string' } } });
    if (!values.data || !values.before || !values.out) throw new Error('Pass --data <dir>, --before <from>,<to> and --out <file>.');
    const before = periodOf(values.before);
    const after = values.after ? periodOf(values.after) : undefined;
    installReadOnlyGuard();
    const token = cliToken();
    const bkper = new Bkper({ oauthTokenProvider: async () => token() });
    const configs = (JSON.parse(await readFile(join(values.data, 'books.json'), 'utf8')) as BookConfig[]).filter(config => !config.excluded);

    const rows = await mapLimit(configs, BOOKS_AT_A_TIME, async config => {
        const transactions = await readTransactions(bkper, config.id, values.since ?? '2026-08-01');
        return { before: tallyOutcomes(config.label, transactions, before), after: after && tallyOutcomes(config.label, transactions, after) };
    });
    await writeFile(values.out, `${JSON.stringify({ measuredAt: new Date().toISOString(), before: values.before, after: values.after, rows }, null, 2)}\n`);

    console.log(`Before: ${totals(rows.map(row => row.before))}`);
    if (after) {
        const afterRows = rows.map(row => row.after!);
        console.log(`After: ${totals(afterRows)}`);
        console.log(JSON.stringify(checkProductionTarget(rows.map(row => row.before), afterRows), null, 2));
    }
}

await main();
process.exit(0);
