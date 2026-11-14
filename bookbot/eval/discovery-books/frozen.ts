/**
 * The frozen dataset: cases from real Books with every search Bookbot's ladder can run, limited to
 * history before each case's date, so later runs replay discovery without reading any Book.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Account, Bkper, Book, TransactionList } from 'bkper-js';

import { AppContext } from '../../src/AppContext.js';
import { AccountChooser } from '../../src/genai/AccountChooser.js';
import { ExtractorDescriptionParts } from '../../src/genai/ExtractorDescriptionParts.js';
import { ACCOUNT_CHOICE_QUESTION, type AccountChoiceAnswer, type AccountChoiceRequest } from '../../src/services/AccountChoice.js';
import type { SearchLevel, SearchTerm } from './score.js';

/** A Book of the dataset, in the private `books.json`. */
export interface BookConfig {
    id: string;
    label: string;
    /** Accounts whose posted transactions become cases; the other side is the expected Account. */
    bankAccounts: string[];
    /** Why the Book is in or out, in plain words. */
    note?: string;
    excluded?: boolean;
}

/** A failed search, replayed as the same failure. */
export interface FailedSearch {
    error: string;
}

export interface EvalCase {
    /** The posted transaction the case comes from. */
    id: string;
    /** The draft discovery sees: the posted transaction with only the bank side. */
    draft: bkper.Transaction;
    expectedAccountId: string;
    /** Every search the ladder can run, by the query Bookbot sends, to the IDs it returned. */
    searches: Record<string, string[] | FailedSearch>;
}

export interface BookSnapshot {
    version: 1;
    bookId: string;
    label: string;
    takenAt: string;
    /** When searches the snapshot lacked were added, after a change to Bookbot's searches. */
    filledAt?: string;
    /** Transactions each search read; a search for more needs a new snapshot. */
    searchLimit: number;
    accounts: Record<string, bkper.Account>;
    transactions: Record<string, bkper.Transaction>;
    /** Description parts by the description Bookbot extracted them from. */
    descriptionParts: Record<string, string[]>;
    cases: EvalCase[];
}

/** Jev's recorded answer to one request. */
export interface JevAnswer {
    choice: string;
    confidence: number;
    probabilities?: Record<string, number>;
}

/** A case needs data the snapshot does not hold: take a new snapshot instead of reading Books. */
export class MissingSnapshotError extends Error {}

export const EVAL_ENV: Env = { BKPER_AI_BASE_URL: 'https://ai.bkper.app/v1' };
const APP_PROPERTY_PREFIXES = ['bookbot_', 'agent_', 'extractor_'];

export async function readJsonGz<T>(path: string): Promise<T> {
    return JSON.parse(new TextDecoder().decode(Bun.gunzipSync(await readFile(path)))) as T;
}

export async function writeJsonGz(path: string, value: unknown): Promise<void> {
    await writeFile(path, Bun.gzipSync(JSON.stringify(value)));
}

/** Visible properties a person or bank feed set; app provenance would block or bias options. */
export function operationProperties(properties: bkper.Transaction['properties']): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(properties ?? {})) {
        const lowerKey = key.toLowerCase();
        if (key.endsWith('_') || APP_PROPERTY_PREFIXES.some(prefix => lowerKey.startsWith(prefix))) continue;
        result[key] = value;
    }
    return result;
}

/** The fields discovery reads from a listed transaction. */
export function listedTransaction(payload: bkper.Transaction): bkper.Transaction {
    return {
        id: payload.id,
        date: payload.date,
        description: payload.description,
        amount: payload.amount,
        creditAccount: payload.creditAccount?.id ? { id: payload.creditAccount.id } : undefined,
        debitAccount: payload.debitAccount?.id ? { id: payload.debitAccount.id } : undefined,
        tags: payload.tags,
        properties: payload.properties,
        createdBy: payload.createdBy,
        posted: payload.posted,
    };
}

/** The draft Bookbot would receive for a posted transaction, keeping only the bank side. */
export function draftFrom(posted: bkper.Transaction, bankSide: 'credit' | 'debit'): bkper.Transaction {
    const bank = bankSide === 'credit' ? posted.creditAccount : posted.debitAccount;
    return {
        description: posted.description,
        amount: posted.amount,
        date: posted.date,
        tags: posted.tags,
        properties: operationProperties(posted.properties),
        createdBy: posted.createdBy,
        ...(bankSide === 'credit' ? { creditAccount: { id: bank!.id } } : { debitAccount: { id: bank!.id } }),
    };
}

/** Classifies a query Bookbot sent, by the shapes its search ladder builds. */
export function parseSearch(query: string, draft: bkper.Transaction): { level: SearchLevel; term: SearchTerm } {
    const level: SearchLevel = !query.startsWith('account: \'') ? 'whole Book' : / createdBy:\S+ is:posted$/u.test(query) ? 'known account and creator' : 'known account';
    const quoted = /"(.*)"/su.exec(query)?.[1] ?? '';
    const tags = (draft.tags ?? []).map(tag => tag.toLowerCase().replace(/^#/u, ''));
    const term: SearchTerm = quoted === draft.description ? 'description' : tags.includes(quoted.toLowerCase().replace(/^#/u, '')) ? 'hashtag' : 'description part';
    return { level, term };
}

/** A Book that answers discovery's reads from one case of the snapshot, never from the network. */
export class FrozenBook extends Book {
    readonly queries: string[] = [];

    constructor(private readonly snapshot: BookSnapshot, private readonly evalCase: EvalCase) {
        super({ id: snapshot.bookId, name: snapshot.label });
    }

    override async getAccount(idOrName?: string): Promise<Account | undefined> {
        if (!idOrName) return undefined;
        const payload = this.snapshot.accounts[idOrName]
            ?? Object.values(this.snapshot.accounts).find(account => account.name?.toLowerCase() === idOrName.toLowerCase());
        return payload ? new Account(this, structuredClone(payload)) : undefined;
    }

    override async listTransactions(query?: string, limit?: number): Promise<TransactionList> {
        const key = query ?? '';
        this.queries.push(key);
        const recorded = this.evalCase.searches[key];
        if (recorded === undefined) throw new MissingSnapshotError(`Case ${this.evalCase.id} has no recorded search for this query.`);
        if ((limit ?? 0) > this.snapshot.searchLimit) throw new MissingSnapshotError(`The snapshot read ${this.snapshot.searchLimit} transactions per search, not ${limit}.`);
        if (!Array.isArray(recorded)) throw new Error(recorded.error);
        const items = recorded.slice(0, limit).map(id => structuredClone(this.snapshot.transactions[id]));
        return new TransactionList(this, { items });
    }
}

/** Description parts from the snapshot, so replays never call the extraction model. */
export class FrozenDescriptionParts extends ExtractorDescriptionParts {
    constructor(private readonly parts: Record<string, string[]>) {
        super(EVAL_ENV);
    }

    override async extract(description: string): Promise<string[]> {
        const parts = this.parts[description];
        if (!parts) throw new MissingSnapshotError('A description has no recorded parts.');
        return [...parts];
    }
}

export function requestKey(request: AccountChoiceRequest): string {
    return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}

export interface JevCall {
    /** How many searches had run when Jev was asked: the deciding search is the last of them. */
    afterQueries: number;
    options: number;
    answer: JevAnswer;
}

/**
 * Answers from the recording; with `live`, asks Jev for requests not recorded yet and records them.
 * `token` authorizes live calls, as Platform outbound does for the deployed app.
 */
export class RecordedAccountChooser extends AccountChooser {
    private lastProbabilities?: Record<string, number>;

    constructor(
        private readonly recording: Map<string, JevAnswer>,
        private readonly live: { token: () => string } | undefined,
        private readonly onAnswer: (request: AccountChoiceRequest, answer: JevAnswer) => void,
    ) {
        super({
            baseUrl: EVAL_ENV.BKPER_AI_BASE_URL,
            fetch: async (input, init) => {
                const headers = new Headers(init?.headers);
                headers.set('authorization', `Bearer ${live?.token()}`);
                headers.set('bkper-ai-source', 'bookbot-eval');
                const response = await fetch(input, { ...init, headers });
                if (response.ok) {
                    const body = (await response.clone().json()) as { answers?: Record<string, { probabilities?: Record<string, number> }> };
                    this.lastProbabilities = body.answers?.[ACCOUNT_CHOICE_QUESTION]?.probabilities;
                }
                return response;
            },
        });
    }

    override async choose(request: AccountChoiceRequest): Promise<AccountChoiceAnswer> {
        const key = requestKey(request);
        let answer = this.recording.get(key);
        if (!answer) {
            if (!this.live) throw new MissingSnapshotError('Jev has no recorded answer for this request; run with --live.');
            const { choice, confidence } = await super.choose(request);
            answer = { choice, confidence, probabilities: this.lastProbabilities };
            this.recording.set(key, answer);
        }
        this.onAnswer(request, answer);
        return { choice: answer.choice, confidence: answer.confidence };
    }
}

/** Bookbot's context with the evaluation's description parts and Jev. */
export class EvalContext extends AppContext {
    constructor(
        bkper: Bkper,
        private readonly descriptionParts: (onError?: (error: unknown) => void) => ExtractorDescriptionParts,
        private readonly accountChooser: () => AccountChooser,
    ) {
        super(bkper, EVAL_ENV);
    }

    override createExtractorDescriptionParts(onError?: (error: unknown) => void): ExtractorDescriptionParts {
        return this.descriptionParts(onError);
    }

    override createAccountChooser(): AccountChooser {
        return this.accountChooser();
    }
}

/** Runs `work` over `items` with at most `limit` at a time, keeping the order of results. */
export async function mapLimit<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    async function worker(): Promise<void> {
        while (next < items.length) {
            const index = next++;
            results[index] = await work(items[index], index);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

/** A token from the Bkper CLI, refreshed every ten minutes so long runs outlive one token. */
export function cliToken(): () => string {
    let token = '';
    let fetchedAt = 0;
    return () => {
        if (!token || Date.now() - fetchedAt > 10 * 60_000) {
            const result = Bun.spawnSync(['bkper', 'auth', 'token']);
            token = result.stdout.toString().trim();
            if (result.exitCode !== 0 || !token) throw new Error('`bkper auth token` failed; run `bkper auth login`.');
            fetchedAt = Date.now();
        }
        return token;
    };
}
