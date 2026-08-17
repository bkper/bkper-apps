import { afterEach, describe, expect, test } from 'bun:test';
import { Account, Bkper, Book, Transaction, TransactionList } from 'bkper-js';
import { AppContext } from '../../../src/AppContext';
import EventHandlerTransactionDeleted from '../../../src/events/handlers/EventHandlerTransactionDeleted';

class DeletionHandler extends EventHandlerTransactionDeleted {
    discoverIds(
        book: Book,
        account: bkper.Account,
        transaction: bkper.Transaction
    ): Promise<string[]> {
        return this.getTaxTransactionsIds(book, account, transaction);
    }
}

interface DeletionSdkFixture {
    accounts?: Record<string, bkper.Account>;
    transactionsByQuery?: Record<string, bkper.Transaction[]>;
}

type DeletionSdkCall =
    | { operation: 'getAccount'; accountId: string | undefined }
    | { operation: 'listTransactions'; query: string | undefined }
    | { operation: 'uncheck'; transactionId: string | undefined }
    | { operation: 'trash'; transactionId: string | undefined };

const methodRestorers: (() => void)[] = [];

afterEach(() => {
    while (methodRestorers.length > 0) {
        methodRestorers.pop()?.();
    }
});

function replaceMethod<T extends object, K extends keyof T>(target: T, name: K, value: T[K]): void {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    Object.defineProperty(target, name, {
        configurable: true,
        writable: true,
        value,
    });
    methodRestorers.push(() => {
        if (descriptor) {
            Object.defineProperty(target, name, descriptor);
        } else {
            Reflect.deleteProperty(target, name);
        }
    });
}

function interceptDeletionSdk(fixture: DeletionSdkFixture = {}): DeletionSdkCall[] {
    const calls: DeletionSdkCall[] = [];

    replaceMethod(
        Book.prototype,
        'getAccount',
        async function (this: Book, accountId?: string): Promise<Account | undefined> {
            calls.push({ operation: 'getAccount', accountId });
            const payload = accountId == null ? undefined : fixture.accounts?.[accountId];
            return payload ? new Account(this, payload) : undefined;
        }
    );
    replaceMethod(
        Book.prototype,
        'listTransactions',
        async function (
            this: Book,
            query?: string,
            _limit?: number,
            _cursor?: string
        ): Promise<TransactionList> {
            calls.push({ operation: 'listTransactions', query });
            return new TransactionList(this, {
                items: query == null ? [] : (fixture.transactionsByQuery?.[query] ?? []),
            });
        }
    );
    replaceMethod(
        Transaction.prototype,
        'uncheck',
        async function (this: Transaction): Promise<Transaction> {
            calls.push({ operation: 'uncheck', transactionId: this.getId() });
            this.setChecked(false);
            return this;
        }
    );
    replaceMethod(
        Transaction.prototype,
        'trash',
        async function (this: Transaction): Promise<Transaction> {
            calls.push({ operation: 'trash', transactionId: this.getId() });
            return this;
        }
    );

    return calls;
}

function createBook(): Book {
    return new Book({
        id: 'book-1',
        name: 'Tax Book',
        decimalSeparator: 'DOT',
        fractionDigits: 2,
    });
}

function createAccount(
    id: string,
    properties: Record<string, string> = {},
    groups: bkper.Group[] = []
): bkper.Account {
    return { id, name: id, properties, groups };
}

function createTransaction(overrides: Partial<bkper.Transaction> = {}): bkper.Transaction {
    return {
        id: 'source-1',
        posted: true,
        agentId: 'tester',
        date: '2024-01-15',
        amount: '100',
        description: 'Source transaction',
        creditAccount: createAccount('origin'),
        debitAccount: createAccount('destination'),
        properties: {},
        ...overrides,
    };
}

function createLinkedTransaction(
    id: string,
    checked: boolean,
    amount: string,
    description: string
): bkper.Transaction {
    return {
        id,
        posted: true,
        checked,
        date: '2024-01-15',
        dateFormatted: '15/01/2024',
        amount,
        description,
    };
}

function createEvent(
    transaction: bkper.Transaction,
    previousAttributes?: Record<string, string>
): bkper.Event {
    return {
        type: 'TRANSACTION_DELETED',
        book: createBook().json(),
        user: { username: 'tester' },
        agent: { id: 'tester' },
        data: {
            object: { transaction },
            previousAttributes,
        },
    };
}

function createHandler(): DeletionHandler {
    return new DeletionHandler(new AppContext(new Bkper()));
}

describe('legacy tax deletion discovery', () => {
    test('discovers current Account and Group remote ids in tax-property order', async () => {
        const account = createAccount(
            'origin',
            {
                tax_rate: '1',
                tax_included_rate: '2',
                tax_included: '',
                tax_excluded_rate: '0',
                tax_excluded: '   ',
            },
            [
                {
                    id: 'group-1',
                    properties: { tax_included: '3', tax_excluded: '4' },
                },
                { id: 'group-without-properties' },
            ]
        );

        const ids = await createHandler().discoverIds(
            createBook(),
            account,
            createTransaction({ creditAccount: account })
        );

        expect(ids).toEqual([
            'tax_source-1_origin',
            'tax_included_rate_source-1_origin',
            'tax_excluded_rate_source-1_origin',
            'tax_included_source-1_group-1',
            'tax_excluded_source-1_group-1',
        ]);
    });

    test('loads previous origin and destination Accounts before linked Transaction queries', async () => {
        const calls = interceptDeletionSdk({
            accounts: {
                'old-origin': createAccount('old-origin', { tax_included_rate: '10' }, [
                    {
                        id: 'old-origin-group',
                        properties: { tax_excluded_rate: '5' },
                    },
                ]),
                'old-destination': createAccount('old-destination', { tax_rate: '-2' }),
            },
        });
        const result = await createHandler().handleEvent(
            createEvent(createTransaction(), {
                creditAccId: 'old-origin',
                debitAccId: 'old-destination',
            })
        );

        expect(result).toBe(false);
        expect(calls).toEqual([
            { operation: 'getAccount', accountId: 'old-origin' },
            { operation: 'getAccount', accountId: 'old-destination' },
            {
                operation: 'listTransactions',
                query: 'remoteId:tax_included_rate_source-1_old-origin',
            },
            {
                operation: 'listTransactions',
                query: 'remoteId:tax_excluded_rate_source-1_old-origin-group',
            },
            {
                operation: 'listTransactions',
                query: 'remoteId:tax_source-1_old-destination',
            },
        ]);
    });

    test('does not reload previous Account ids that match the current movement', async () => {
        const calls = interceptDeletionSdk();

        const result = await createHandler().handleEvent(
            createEvent(createTransaction(), {
                creditAccId: 'origin',
                debitAccId: 'destination',
            })
        );

        expect(result).toBe(false);
        expect(calls).toEqual([]);
    });

    test('preserves the missing previous Account failure', async () => {
        const calls = interceptDeletionSdk();

        await expect(
            createHandler().handleEvent(
                createEvent(createTransaction(), { creditAccId: 'missing-origin' })
            )
        ).rejects.toThrow();

        expect(calls).toEqual([{ operation: 'getAccount', accountId: 'missing-origin' }]);
    });
});

describe('legacy linked tax Transaction deletion', () => {
    test('uses the first linked Transaction and preserves sequential uncheck and trash order', async () => {
        const origin = createAccount('origin', { tax_included_rate: '10' }, [
            {
                id: 'origin-group',
                properties: { tax_excluded_rate: '5' },
            },
        ]);
        const destination = createAccount('destination', { tax_rate: '-2' });
        const source = createTransaction({
            creditAccount: origin,
            debitAccount: destination,
        });
        const sourceBefore = structuredClone(source);
        const calls = interceptDeletionSdk({
            transactionsByQuery: {
                'remoteId:tax_included_rate_source-1_origin': [
                    createLinkedTransaction('linked-1', true, '10', 'Origin tax'),
                    createLinkedTransaction('ignored-second-match', true, '99', 'Ignored'),
                ],
                'remoteId:tax_excluded_rate_source-1_origin-group': [
                    createLinkedTransaction('linked-2', false, '5', 'Group tax'),
                ],
                'remoteId:tax_source-1_destination': [],
            },
        });

        const result = await createHandler().handleEvent(createEvent(source));

        expect(result).toEqual([
            'DELETED: 15/01/2024 10.00 Origin tax',
            'DELETED: 15/01/2024 5.00 Group tax',
        ]);
        expect(calls).toEqual([
            {
                operation: 'listTransactions',
                query: 'remoteId:tax_included_rate_source-1_origin',
            },
            { operation: 'uncheck', transactionId: 'linked-1' },
            { operation: 'trash', transactionId: 'linked-1' },
            {
                operation: 'listTransactions',
                query: 'remoteId:tax_excluded_rate_source-1_origin-group',
            },
            { operation: 'trash', transactionId: 'linked-2' },
            {
                operation: 'listTransactions',
                query: 'remoteId:tax_source-1_destination',
            },
        ]);
        expect(source).toEqual(sourceBefore);
    });

    test('returns false without SDK calls when no tax remote ids are configured', async () => {
        const calls = interceptDeletionSdk();

        const result = await createHandler().handleEvent(createEvent(createTransaction()));

        expect(result).toBe(false);
        expect(calls).toEqual([]);
    });
});
