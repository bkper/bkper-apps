/**
 * Freezes cases from real Books: reads only, never writes.
 *
 *   bun eval/discovery-books/snapshot.ts --data <dir> [--books <label>,<label>] [--cases <per Book>]
 *
 * For each Book in `<dir>/books.json`, takes the most recent posted transactions with a description
 * and exactly one side on a bank Account, dated up to today and not created by an app that
 * derives transactions from others, and records every search Bookbot's ladder can run for
 * each, limited to history before the case's date. Description parts are extracted once with the
 * live model. Writes `<dir>/snapshot/<bookId>.json.gz`.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Bkper, Book, BkperError, Transaction, TransactionList } from 'bkper-js';

import { BkperAIResponsesClient } from '../../src/genai/BkperAIResponsesClient.js';
import { ExtractorDescriptionParts } from '../../src/genai/ExtractorDescriptionParts.js';
import { AccountChooser } from '../../src/genai/AccountChooser.js';
import { Discovery } from '../../src/services/DiscoveryService.js';
import {
    cliToken,
    draftFrom,
    EVAL_ENV,
    EvalContext,
    listedTransaction,
    mapLimit,
    writeJsonGz,
    type BookConfig,
    type BookSnapshot,
    type EvalCase,
} from './frozen.js';
import { installReadOnlyGuard } from './readOnly.js';

const CASES_PER_BOOK = 600;
const PAGE = 500;
const BOOKS_AT_A_TIME = 3;
const CASES_AT_A_TIME = 6;
const EXTRACTION_ATTEMPTS = 2;
/**
 * Apps that copy or derive transactions from ones already categorized elsewhere: their transactions
 * are not lines that reach Bookbot, and mirrored Books would count the same choice twice.
 */
const DERIVING_APPS = new Set(['Exchange Bot', 'Tax Bot', 'Portfolio Bot', 'Subledger Bot', 'Inventory Bot']);

/**
 * Extraction with one retry; a failure leaves no parts, like the deployed app. Cases with the same
 * description share one extraction: the model can answer differently each time, and every case
 * must replay with the parts its searches were recorded with.
 */
class SnapshotDescriptionParts extends ExtractorDescriptionParts {
    private failed = false;

    constructor(token: () => string, private readonly extractions: Map<string, Promise<string[]>>, private readonly failures: { extractions: number }) {
        super(EVAL_ENV, new BkperAIResponsesClient({ baseUrl: EVAL_ENV.BKPER_AI_BASE_URL, oauthToken: token() }), () => {
            this.failed = true;
        });
    }

    override async extract(description: string): Promise<string[]> {
        if (!this.extractions.has(description)) this.extractions.set(description, this.extractOnce(description));
        return [...await this.extractions.get(description)!];
    }

    private async extractOnce(description: string): Promise<string[]> {
        for (let attempt = 1; attempt <= EXTRACTION_ATTEMPTS; attempt++) {
            this.failed = false;
            const parts = await super.extract(description);
            if (!this.failed) return parts;
        }
        this.failures.extractions++;
        return [];
    }
}

class NoAccountChooser extends AccountChooser {
    override async choose(): Promise<never> {
        throw new Error('Snapshots never ask Jev: every search returns no options.');
    }
}

async function selectCases(book: Book, bankAccountIds: Map<string, string>, casesPerBook: number): Promise<bkper.Transaction[]> {
    const byId = new Map<string, bkper.Transaction>();
    for (const name of bankAccountIds.keys()) {
        let cursor: string | undefined;
        let read = 0;
        do {
            const list = await book.listTransactions(`account:'${name}' is:posted`, PAGE, cursor);
            for (const transaction of list.getItems()) byId.set(transaction.getId()!, transaction.json());
            read += list.getItems().length;
            cursor = list.getItems().length === PAGE ? list.getCursor() : undefined;
        } while (cursor && read < 2 * casesPerBook);
    }
    const bankIds = new Set(bankAccountIds.values());
    const today = new Date().toISOString().slice(0, 10);
    return [...byId.values()]
        .filter(transaction => {
            const credit = transaction.creditAccount?.id;
            const debit = transaction.debitAccount?.id;
            return !!transaction.description?.trim() && !!credit && !!debit && bankIds.has(credit) !== bankIds.has(debit)
                && !DERIVING_APPS.has(transaction.agentName ?? '')
                // Future-dated entries are schedules, not lines from a bank.
                && (transaction.date ?? '') <= today;
        })
        .sort((left, right) => (right.date ?? '').localeCompare(left.date ?? '') || (right.createdAt ?? '').localeCompare(left.createdAt ?? ''))
        .slice(0, casesPerBook);
}

async function snapshotBook(bkper: Bkper, config: BookConfig, token: () => string, casesPerBook: number): Promise<BookSnapshot> {
    const book = await bkper.getBook(config.id);
    const bankAccountIds = new Map<string, string>();
    for (const name of config.bankAccounts) {
        const account = await book.getAccount(name);
        if (!account) throw new Error(`${config.label}: no Account named ${name}.`);
        bankAccountIds.set(account.getName()!, account.getId()!);
    }
    const posted = await selectCases(book, bankAccountIds, casesPerBook);
    const bankIds = new Set(bankAccountIds.values());

    const snapshot: BookSnapshot = {
        version: 1, bookId: config.id, label: config.label, takenAt: new Date().toISOString(), searchLimit: 0,
        accounts: {}, transactions: {}, descriptionParts: {}, cases: [],
    };
    const failures = { searches: 0, extractions: 0, dropped: 0 };
    const recordAccount = async (id: string | undefined) => {
        if (!id || snapshot.accounts[id]) return;
        try {
            const account = await book.getAccount(id);
            if (account) snapshot.accounts[id] = account.json();
        } catch (error) {
            if (!(error instanceof BkperError && error.code === 404)) throw error;
        }
    };

    const extractions = new Map<string, Promise<string[]>>();
    const started = Date.now();
    const cases = await mapLimit(posted, CASES_AT_A_TIME, async (transaction, index): Promise<EvalCase | undefined> => {
        const bankSide = bankIds.has(transaction.creditAccount!.id!) ? 'credit' : 'debit';
        const evalCase: EvalCase = {
            id: transaction.id!,
            draft: draftFrom(transaction, bankSide),
            expectedAccountId: (bankSide === 'credit' ? transaction.debitAccount : transaction.creditAccount)!.id!,
            searches: {},
        };
        await recordAccount(evalCase.expectedAccountId);
        await recordAccount(bankSide === 'credit' ? transaction.creditAccount?.id : transaction.debitAccount?.id);

        // Every search returns nothing to discovery, so it walks its whole ladder and each search is recorded.
        const view = Object.create(book) as Book;
        view.listTransactions = async (query?: string, limit?: number): Promise<TransactionList> => {
            const key = query ?? '';
            const size = limit ?? 0;
            snapshot.searchLimit = Math.max(snapshot.searchLimit, size);
            try {
                const items = (await book.listTransactions(`${key} before:${transaction.date}`, size + 1)).getItems()
                    .map(item => item.json())
                    .filter(item => item.id !== transaction.id)
                    .slice(0, size);
                for (const item of items) {
                    snapshot.transactions[item.id!] ??= listedTransaction(item);
                    await recordAccount(item.creditAccount?.id);
                    await recordAccount(item.debitAccount?.id);
                }
                evalCase.searches[key] = items.map(item => item.id!);
            } catch (error) {
                failures.searches++;
                evalCase.searches[key] = { error: error instanceof Error ? error.message : String(error) };
            }
            return new TransactionList(view, { items: [] });
        };

        const context = new EvalContext(bkper, () => new SnapshotDescriptionParts(token, extractions, failures), () => new NoAccountChooser());
        let unexpected: unknown;
        await new Discovery(context, error => { unexpected ??= error; }).discover(new Transaction(view, structuredClone(evalCase.draft)));
        if (unexpected) {
            // Searches and extraction failures are recorded above; anything else would not replay faithfully.
            failures.dropped++;
            console.error(`${config.label}: dropped a case: ${unexpected instanceof Error ? unexpected.message : String(unexpected)}`);
            return undefined;
        }

        if ((index + 1) % 100 === 0) console.log(`${config.label}: ${index + 1}/${posted.length} cases, ${((Date.now() - started) / 60_000).toFixed(1)} min`);
        return evalCase;
    });
    snapshot.cases = cases.filter((evalCase): evalCase is EvalCase => !!evalCase);
    for (const [description, parts] of extractions) snapshot.descriptionParts[description] = await parts;
    console.log(`${config.label}: ${snapshot.cases.length} cases, ${Object.keys(snapshot.transactions).length} transactions, `
        + `${failures.searches} failed searches, ${failures.extractions} failed extractions, ${failures.dropped} dropped cases, ${((Date.now() - started) / 60_000).toFixed(1)} min`);
    return snapshot;
}

async function main(): Promise<void> {
    const { values } = parseArgs({ options: { data: { type: 'string' }, books: { type: 'string' }, cases: { type: 'string' } } });
    if (!values.data) throw new Error('Pass --data <dir>, the private dataset directory.');
    const casesPerBook = Number(values.cases ?? CASES_PER_BOOK);
    installReadOnlyGuard();
    const token = cliToken();
    const bkper = new Bkper({ oauthTokenProvider: async () => token() });
    const only = values.books?.split(',');
    const configs = (JSON.parse(await readFile(join(values.data, 'books.json'), 'utf8')) as BookConfig[])
        .filter(config => !config.excluded && (!only || only.includes(config.label)));
    await mkdir(join(values.data, 'snapshot'), { recursive: true });
    await mapLimit(configs, BOOKS_AT_A_TIME, async config => {
        const snapshot = await snapshotBook(bkper, config, token, casesPerBook);
        await writeJsonGz(join(values.data!, 'snapshot', `${config.id}.json.gz`), snapshot);
    });
}

await main();
process.exit(0);
