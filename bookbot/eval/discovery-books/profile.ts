/**
 * Shows each Book's likely bank Accounts, to choose the dataset's cases. Reads only, never writes.
 *
 *   bun eval/discovery-books/profile.ts --data <dir> [--books <label>,<label>]
 *
 * From each Book's 1,000 most recent posted transactions, lists the permanent Accounts with the
 * most transactions and the most distinct Accounts on the other side, and who created them.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Bkper } from 'bkper-js';

import { cliToken, mapLimit, type BookConfig } from './frozen.js';
import { installReadOnlyGuard } from './readOnly.js';

const SAMPLE = 1000;
const SHOWN = 6;

async function profile(bkper: Bkper, config: BookConfig): Promise<string> {
    const book = await bkper.getBook(config.id);
    const accounts = new Map((await book.getAccounts()).map(account => [account.getId()!, account]));
    const transactions = (await book.listTransactions('is:posted', SAMPLE)).getItems().map(transaction => transaction.json());
    const usage = new Map<string, { count: number; partners: Set<string> }>();
    const creators = new Map<string, number>();
    for (const transaction of transactions) {
        const sides = [transaction.creditAccount?.id, transaction.debitAccount?.id];
        for (const [index, id] of sides.entries()) {
            if (!id) continue;
            const entry = usage.get(id) ?? { count: 0, partners: new Set<string>() };
            entry.count++;
            const partner = sides[1 - index];
            if (partner) entry.partners.add(partner);
            usage.set(id, entry);
        }
        const creator = transaction.agentName ? `app ${transaction.agentName}` : 'person or API';
        creators.set(creator, (creators.get(creator) ?? 0) + 1);
    }
    const permanent = [...usage.entries()]
        .filter(([id]) => accounts.get(id)?.isPermanent())
        .sort(([, left], [, right]) => right.count - left.count)
        .slice(0, SHOWN);
    const dates = transactions.map(transaction => transaction.date ?? '').sort();
    return [
        `## ${config.label} (${transactions.length} posted, ${dates[0]} to ${dates[dates.length - 1]})`,
        `Created by: ${[...creators.entries()].sort(([, left], [, right]) => right - left).map(([creator, count]) => `${creator} ${count}`).join(', ')}`,
        ...permanent.map(([id, entry]) => `- ${accounts.get(id)?.getName()} (${accounts.get(id)?.getType()}): ${entry.count} transactions, ${entry.partners.size} other Accounts`),
    ].join('\n');
}

async function main(): Promise<void> {
    const { values } = parseArgs({ options: { data: { type: 'string' }, books: { type: 'string' } } });
    if (!values.data) throw new Error('Pass --data <dir>, the private dataset directory.');
    installReadOnlyGuard();
    const token = cliToken();
    const bkper = new Bkper({ oauthTokenProvider: async () => token() });
    const only = values.books?.split(',');
    const configs = (JSON.parse(await readFile(join(values.data, 'books.json'), 'utf8')) as BookConfig[])
        .filter(config => !only || only.includes(config.label));
    for (const report of await mapLimit(configs, 4, config => profile(bkper, config))) console.log(`${report}\n`);
}

await main();
process.exit(0);
