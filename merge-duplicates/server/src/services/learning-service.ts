import type { Account, Book, Group } from 'bkper-js';
import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../app-context';
import type { TransactionFingerprint } from './candidate-service';
import { getLearningPermission } from './permission-service';

export const LEARNING_PROPERTY = 'merge_duplicate_examples';
const MAX_EXAMPLES = 40;

export interface RejectedPairSnapshot {
    first: TransactionFingerprint;
    second: TransactionFingerprint;
}

export interface LearningRequest {
    bookId: string;
    accountId?: string | null;
    groupId?: string | null;
    pair: RejectedPairSnapshot;
    additionalPairs?: RejectedPairSnapshot[];
}

export interface LearningResult {
    saved: boolean;
    skipped: boolean;
    resourceType: 'account' | 'group' | 'book' | null;
    resourceName: string | null;
    propertyKey: string;
    savedCount: number;
    notice?: string;
}

export function formatRejectedPairExample(pair: RejectedPairSnapshot): string {
    return `${formatTransaction(pair.first)} <> ${formatTransaction(pair.second)}`;
}

export function appendLearningExample(existing: string | undefined, example: string): string {
    const lines = (existing ?? '').split(/\r?\n/u).map(cleanLine).filter(Boolean);
    lines.push(cleanLine(example));
    return lines.slice(-MAX_EXAMPLES).join('\n');
}

export async function saveRejectedPair(
    context: AppContext,
    request: LearningRequest
): Promise<LearningResult> {
    const book = await context.bkper.getBook(request.bookId, true, true);
    if (getLearningPermission(book) === 'skip') {
        return {
            saved: false,
            skipped: true,
            resourceType: null,
            resourceName: null,
            propertyKey: LEARNING_PROPERTY,
            savedCount: 0,
            notice: 'Post collaborators can merge, but learning examples require Owner or Editor permission.',
        };
    }

    const target = await selectLearningTarget(book, request.accountId, request.groupId);
    const pairs = [request.pair, ...(request.additionalPairs ?? [])];
    let updated = target.resource.getProperty(LEARNING_PROPERTY);
    for (const pair of pairs) {
        updated = appendLearningExample(updated, formatRejectedPairExample(pair));
    }
    target.resource.setVisibleProperty(LEARNING_PROPERTY, updated);
    await target.resource.update();

    return {
        saved: true,
        skipped: false,
        resourceType: target.type,
        resourceName: target.resource.getName() ?? null,
        propertyKey: LEARNING_PROPERTY,
        savedCount: pairs.length,
    };
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

type LearningResource = Book | Account | Group;

async function selectLearningTarget(
    book: Book,
    accountId?: string | null,
    groupId?: string | null
): Promise<{ type: 'account' | 'group' | 'book'; resource: LearningResource }> {
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

function formatTransaction(transaction: TransactionFingerprint): string {
    const movement = `${transaction.fromAccount?.name || '—'} → ${transaction.toAccount?.name || '—'}`;
    const description = quoted(transaction.description);
    const properties = Object.entries(transaction.properties)
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, 12)
        .map(([key, value]) => `${trimContext(key, 40)}=${trimContext(value, 80)}`)
        .join(', ');
    return cleanLine(
        `${transaction.date} ${transaction.amount} ${movement} ${description}${properties ? ` [${properties}]` : ''}`
    );
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
