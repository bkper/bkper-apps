import { Amount, type Account, type Book, type Group } from 'bkper-js';
import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../app-context';
import type { TransactionFingerprint } from './candidate-service';
import { requireLearningPermission } from './permission-service';

export const LEARNING_PROPERTY = 'merge_duplicate_examples';
const MAX_EXAMPLES = 50;
const MAX_PROPERTY_CHARACTERS = 90_000;

export type RejectedPair = bkper.Transaction[];

export interface LearningRequest {
    bookId: string;
    accountId?: string | null;
    groupId?: string | null;
    examples: RejectedPair[];
}

export type LearningResult =
    { book: bkper.Book } | { group: bkper.Group } | { account: bkper.Account };

export function formatRejectedPairExample(pair: RejectedPair): string {
    const [first, second] = pair;
    if (!first || !second || pair.length !== 2) {
        throw new Error('A rejected-pair example requires exactly two transactions.');
    }
    return `${formatTransaction(first)} <> ${formatTransaction(second)}`;
}

export function appendLearningExamples(
    existing: string | undefined,
    examples: readonly string[]
): string {
    const lines = [...(existing ?? '').split(/\r?\n/u), ...examples]
        .map(cleanLine)
        .filter(Boolean)
        .map(line => line.slice(0, MAX_PROPERTY_CHARACTERS))
        .slice(-MAX_EXAMPLES);

    while (lines.join('\n').length > MAX_PROPERTY_CHARACTERS) lines.shift();
    return lines.join('\n');
}

export async function saveRejectedExamples(
    context: AppContext,
    request: LearningRequest
): Promise<LearningResult> {
    const book = await context.bkper.getBook(request.bookId, true, true);
    requireLearningPermission(book);

    const target = await selectLearningTarget(book, request.accountId, request.groupId);
    const examples = request.examples.map(formatRejectedPairExample);
    const updated = appendLearningExamples(
        target.resource.getProperty(LEARNING_PROPERTY),
        examples
    );
    target.resource.setVisibleProperty(LEARNING_PROPERTY, updated);

    if (target.type === 'account') {
        const account = await target.resource.update();
        return { account: account.json() };
    }
    if (target.type === 'group') {
        const group = await target.resource.update();
        return { group: group.json() };
    }
    const updatedBook = await target.resource.update();
    return { book: updatedBook.json() };
}

export async function collectApplicableLearningExamples(
    book: Book,
    transactions: readonly TransactionFingerprint[]
): Promise<string[]> {
    const examples = readExamples(book);
    const seenAccountIds = new Set<string>();

    for (const transaction of transactions) {
        for (const snapshot of [transaction.fromAccount, transaction.toAccount]) {
            if (!snapshot || seenAccountIds.has(snapshot.id)) continue;
            seenAccountIds.add(snapshot.id);
            const account = await book.getAccount(snapshot.id);
            if (!account) continue;
            examples.push(...readExamples(account));
            for (const group of await account.getGroups()) {
                let current: Group | undefined = group;
                while (current) {
                    examples.push(...readExamples(current));
                    current = current.getParent();
                }
            }
        }
    }

    return examples;
}

type LearningTarget =
    | { type: 'book'; resource: Book }
    | { type: 'account'; resource: Account }
    | { type: 'group'; resource: Group };

type LearningResource = Book | Account | Group;

async function selectLearningTarget(
    book: Book,
    accountId?: string | null,
    groupId?: string | null
): Promise<LearningTarget> {
    if (accountId) {
        const account = await book.getAccount(accountId);
        if (!account) throw new HTTPException(400, { message: 'Selected account was not found.' });
        return { type: 'account', resource: account };
    }
    if (groupId) {
        const group = await book.getGroup(groupId);
        if (!group) throw new HTTPException(400, { message: 'Selected group was not found.' });
        return { type: 'group', resource: group };
    }
    return { type: 'book', resource: book };
}

function readExamples(resource: LearningResource): string[] {
    return (resource.getProperty(LEARNING_PROPERTY) ?? '')
        .split(/\r?\n/u)
        .map(cleanLine)
        .filter(Boolean);
}

function formatTransaction(transaction: bkper.Transaction): string {
    const movement = `${transaction.creditAccount?.name || '—'} → ${transaction.debitAccount?.name || '—'}`;
    const description = quoted(transaction.description ?? '');
    const properties = Object.entries(transaction.properties ?? {})
        .filter(([key]) => !key.endsWith('_'))
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, 12)
        .map(([key, value]) => `${trimContext(key, 40)}=${trimContext(value, 80)}`)
        .join(', ');
    return cleanLine(
        `${transaction.date ?? ''} ${normalizeAmount(transaction.amount)} ${movement} ${description}${properties ? ` [${properties}]` : ''}`
    );
}

function normalizeAmount(value: string | undefined): string {
    if (!value) return '';
    try {
        return new Amount(value).toString();
    } catch {
        return cleanLine(value);
    }
}

function quoted(value: string): string {
    return `"${trimContext(value, 140).replaceAll('"', "'")}"`;
}

function trimContext(value: string, length: number): string {
    const cleaned = cleanLine(value);
    return cleaned.length <= length ? cleaned : `${cleaned.slice(0, length - 1)}…`;
}

function cleanLine(value: string): string {
    return value
        .replace(/[\r\n]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
}
