import { afterEach, describe, expect, test } from 'bun:test';
import {
    Account,
    AccountType,
    BalancesReport,
    Bkper,
    BkperError,
    Book,
    Group,
    Permission,
    Transaction,
} from 'bkper-js';
import { AppContext } from '../../../src/shared/app-context.js';
import type { ExchangeRates } from '../../../src/api/schemas.js';
import { ExchangeUpdateService } from '../../../src/api/services/exchange-update-service.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function createContext(book: Book): AppContext {
    const bkper = new Bkper();
    bkper.getBook = async bookId => {
        if (bookId === book.getId()) {
            return book;
        }
        const connectedBook = book
            .getCollection()
            ?.getBooks()
            .find(candidate => candidate.getId() === bookId);
        if (!connectedBook) {
            throw new Error(`Unexpected Book load: ${bookId}`);
        }
        return connectedBook;
    };
    return new AppContext(bkper, {
        OPEN_EXCHANGE_RATES_APP_ID: 'test-only',
        ASSETS: { fetch },
    });
}

function createBook(
    id: string,
    code: string,
    properties: Record<string, string> = {},
    extra: Partial<bkper.Book> = {}
): Book {
    return new Book({
        id,
        name: id,
        datePattern: 'yyyy-MM-dd',
        decimalSeparator: 'DOT',
        fractionDigits: 2,
        timeZone: 'UTC',
        permission: Permission.EDITOR,
        properties: { exc_code: code, ...properties },
        ...extra,
    });
}

function createAccount(
    book: Book,
    id: string,
    name: string,
    type = AccountType.ASSET,
    properties: Record<string, string> = {}
): Account {
    return new Account(book, { id, name, type, credit: false, properties, groups: [] });
}

function createReport(book: Book, balances: Map<Account, string>): BalancesReport {
    return new BalancesReport(book, {
        periodicity: 'DAILY',
        accountBalances: Array.from(balances, ([account, cumulativeBalance]) => ({
            name: account.getName(),
            normalizedName: account.getNormalizedName().replaceAll(' ', '_'),
            credit: true,
            cumulativeBalance,
        })),
    });
}

function createGroup(book: Book, id: string, code: string, accounts: Account[]): Group {
    const group = new Group(book, { id, name: code, properties: {} });
    group.getAccounts = async () => accounts;
    return group;
}

function rates(ratesByCode: Record<string, number | string>): ExchangeRates {
    return { base: 'USD', date: '2026-08-05', rates: ratesByCode };
}

describe('legacy menu Exchange Update', () => {
    test('rejects a non-editor before reading balances or mutating the Book', async () => {
        const book = createBook('usd-book', 'USD', {}, { permission: Permission.VIEWER });
        let balanceQueries = 0;
        let audits = 0;
        book.getBalancesReport = async () => {
            balanceQueries += 1;
            return createReport(book, new Map());
        };
        book.audit = () => {
            audits += 1;
        };

        expect(
            ExchangeUpdateService.update(createContext(book), 'usd-book', rates({}))
        ).rejects.toMatchObject({ status: 403 });
        expect(balanceQueries).toBe(0);
        expect(audits).toBe(0);
    });

    test('loads complete charts only for the target and connected Books with matching Accounts', async () => {
        const targetBook = createBook(
            'usd-book',
            'USD',
            {},
            {
                collection: {
                    books: [
                        { id: 'usd-book', properties: { exc_code: 'USD' } },
                        { id: 'eur-book', properties: { exc_code: 'EUR' } },
                        { id: 'jpy-book', properties: { exc_code: 'JPY' } },
                    ],
                },
            }
        );
        const targetAccount = createAccount(targetBook, 'target-account', 'Cash');
        const eurGroup = createGroup(targetBook, 'eur-group', 'EUR', [targetAccount]);
        targetBook.getGroup = async code => {
            if (code === 'EUR') {
                return eurGroup;
            }
            throw new BkperError(404, 'Group not found', 'notFound');
        };
        targetBook.getGroups = async () => [];
        targetBook.getBalancesReport = async () => createReport(targetBook, new Map());
        targetBook.batchCreateTransactions = async transactions => transactions;
        targetBook.audit = () => {};

        const eurBook = createBook('eur-book', 'EUR');
        eurBook.getBalancesReport = async () => createReport(eurBook, new Map());
        eurBook.getAccount = async () => {
            throw new BkperError(404, 'Account not found', 'notFound');
        };
        const jpyBook = createBook('jpy-book', 'JPY');
        jpyBook.getBalancesReport = async () => createReport(jpyBook, new Map());
        targetBook.getCollection()!.getBooks = () => [targetBook, eurBook, jpyBook];

        const getBookCalls: Array<[string, boolean | undefined]> = [];
        const bkper = new Bkper();
        bkper.getBook = async (bookId, includeAccounts) => {
            getBookCalls.push([bookId, includeAccounts]);
            if (bookId === 'usd-book') {
                return targetBook;
            }
            if (bookId === 'eur-book') {
                return eurBook;
            }
            throw new Error(`Unexpected Book load: ${bookId}`);
        };
        const context = new AppContext(bkper, {
            OPEN_EXCHANGE_RATES_APP_ID: 'test-only',
            ASSETS: { fetch },
        });

        const result = await ExchangeUpdateService.update(
            context,
            'usd-book',
            rates({ EUR: 0.8, JPY: 150 })
        );

        expect(result).toEqual({ createdTransactions: [], createdAccounts: [] });
        expect(getBookCalls).toEqual([
            ['usd-book', true],
            ['eur-book', true],
        ]);
    });

    test('audits a successful no-op update', async () => {
        const book = createBook('usd-book', 'USD');
        book.getBalancesReport = async () => createReport(book, new Map());
        let audits = 0;
        book.audit = () => {
            audits += 1;
        };

        const result = await ExchangeUpdateService.update(
            createContext(book),
            'usd-book',
            rates({ EUR: 0.8 })
        );

        expect(result).toEqual({ createdTransactions: [], createdAccounts: [] });
        expect(audits).toBe(1);
    });

    test('returns accepted gain and loss movements in connected-Book order', async () => {
        const book = createBook(
            'usd-book',
            'USD',
            {},
            {
                collection: {
                    books: [
                        { id: 'usd-book', properties: { exc_code: 'USD' } },
                        { id: 'eur-book', properties: { exc_code: 'EUR' } },
                        { id: 'brl-book', properties: { exc_code: 'BRL' } },
                    ],
                },
            }
        );
        const collection = book.getCollection()!;
        const collectionBooks = collection.getBooks();
        collection.getBooks = () => collectionBooks;
        const connectedBooks = collectionBooks.filter(item => item.getId() != 'usd-book');
        const eurBook = connectedBooks[0];
        const brlBook = connectedBooks[1];
        const eurAccount = createAccount(book, 'eur-base', 'EurCash');
        const brlAccount = createAccount(book, 'brl-base', 'BrlCash');
        const eurConnectedAccount = createAccount(eurBook, 'eur-connected', 'EurCash');
        const brlConnectedAccount = createAccount(brlBook, 'brl-connected', 'BrlCash');
        eurConnectedAccount.getGroups = async () => [];
        brlConnectedAccount.getGroups = async () => [];
        const eurExchange = createAccount(
            book,
            'eur-exchange',
            'EurCash EXC',
            AccountType.LIABILITY
        );
        const brlExchange = createAccount(
            book,
            'brl-exchange',
            'BrlCash EXC',
            AccountType.LIABILITY
        );
        const groups = new Map([
            ['EUR', createGroup(book, 'eur-group', 'EUR', [eurAccount])],
            ['BRL', createGroup(book, 'brl-group', 'BRL', [brlAccount])],
        ]);
        const accounts = new Map([
            ['EurCash', eurAccount],
            ['BrlCash', brlAccount],
            ['EurCash EXC', eurExchange],
            ['BrlCash EXC', brlExchange],
        ]);
        const baseQueries: string[] = [];
        book.getGroup = async code => groups.get(code ?? '');
        book.getGroups = async () => [];
        book.getAccount = async name => accounts.get(name ?? '');
        book.getBalancesReport = async query => {
            baseQueries.push(query);
            return createReport(
                book,
                new Map([
                    [eurAccount, '150'],
                    [brlAccount, '250'],
                ])
            );
        };
        eurBook.getAccount = async name =>
            name == eurConnectedAccount.getName() ? eurConnectedAccount : undefined;
        brlBook.getAccount = async name =>
            name == brlConnectedAccount.getName() ? brlConnectedAccount : undefined;
        eurBook.getBalancesReport = async () =>
            createReport(eurBook, new Map([[eurConnectedAccount, '100']]));
        brlBook.getBalancesReport = async () =>
            createReport(brlBook, new Map([[brlConnectedAccount, '50']]));

        globalThis.fetch = (async (input: RequestInfo | URL) => {
            throw new Error(`Unexpected request: ${input.toString()}`);
        }) as unknown as typeof fetch;
        const sequence: string[] = [];
        let batch = 0;
        book.batchCreateTransactions = async transactions => {
            batch += 1;
            sequence.push(`batch-${batch}`);
            return transactions.map(
                (transaction, index) =>
                    new Transaction(book, {
                        ...transaction.json(),
                        id: `accepted-${batch}-${index + 1}`,
                    })
            );
        };
        book.audit = () => {
            sequence.push('audit');
        };

        const result = await ExchangeUpdateService.update(
            createContext(book),
            'usd-book',
            rates({ EUR: '0.5', BRL: '0.25' })
        );

        expect(baseQueries).toEqual(['before:2026-08-06', 'before:2026-08-06']);
        expect(sequence).toEqual(['batch-1', 'batch-2', 'audit']);
        expect(result.createdTransactions.map(transaction => transaction.id)).toEqual([
            'accepted-1-1',
            'accepted-2-1',
        ]);
        expect(result.createdAccounts).toEqual([]);
        expect(result.createdTransactions[0]).toMatchObject({
            amount: '50',
            description: '#exchange_gain',
            creditAccount: { id: 'eur-exchange' },
            debitAccount: { id: 'eur-base' },
            properties: { exc_code: 'EUR', exc_rate: '2', exc_amount: '0' },
        });
        expect(result.createdTransactions[1]).toMatchObject({
            amount: '50',
            description: '#exchange_loss',
            creditAccount: { id: 'brl-base' },
            debitAccount: { id: 'brl-exchange' },
            properties: { exc_code: 'BRL', exc_rate: '4', exc_amount: '0' },
        });
    });

    test('deduplicates an Account matched through multiple Groups', async () => {
        const book = createBook(
            'usd-book',
            'USD',
            {},
            {
                collection: {
                    books: [
                        { id: 'usd-book', properties: { exc_code: 'USD' } },
                        { id: 'eur-book', properties: { exc_code: 'EUR' } },
                    ],
                },
            }
        );
        const collection = book.getCollection()!;
        const collectionBooks = collection.getBooks();
        collection.getBooks = () => collectionBooks;
        const connectedBook = collectionBooks[1];
        const firstAccountWrapper = createAccount(book, 'base-account', 'Cash');
        const secondAccountWrapper = createAccount(book, 'base-account', 'Cash');
        const connectedAccount = createAccount(connectedBook, 'connected-account', 'Cash');
        connectedAccount.getGroups = async () => [];
        const namedGroup = createGroup(book, 'named-group', 'EUR', [firstAccountWrapper]);
        const configuredGroup = new Group(book, {
            id: 'configured-group',
            name: 'Configured EUR',
            properties: { exc_code: 'EUR' },
        });
        configuredGroup.getAccounts = async () => [secondAccountWrapper];
        const exchangeAccount = createAccount(
            book,
            'exchange-account',
            'Cash EXC',
            AccountType.LIABILITY
        );

        book.getGroup = async code => (code == 'EUR' ? namedGroup : undefined);
        book.getGroups = async () => [configuredGroup];
        book.getAccount = async name => (name == 'Cash EXC' ? exchangeAccount : undefined);
        book.getBalancesReport = async () =>
            createReport(book, new Map([[firstAccountWrapper, '150']]));
        connectedBook.getAccount = async name => (name == 'Cash' ? connectedAccount : undefined);
        connectedBook.getBalancesReport = async () =>
            createReport(connectedBook, new Map([[connectedAccount, '100']]));

        let batched: Transaction[] = [];
        book.batchCreateTransactions = async transactions => {
            batched = transactions;
            return transactions;
        };
        book.audit = () => undefined;

        await ExchangeUpdateService.update(createContext(book), 'usd-book', rates({ EUR: '0.5' }));

        expect(batched).toHaveLength(1);
    });

    test('uses historical balances and preserves exchange Account creation rules', async () => {
        const book = createBook(
            'usd-book',
            'USD',
            {},
            {
                closingDate: '2026-01-31',
                collection: {
                    books: [
                        { id: 'usd-book', properties: { exc_code: 'USD' } },
                        { id: 'eur-book', properties: { exc_code: 'EUR' } },
                    ],
                },
            }
        );
        const collection = book.getCollection()!;
        const collectionBooks = collection.getBooks();
        collection.getBooks = () => collectionBooks;
        const connectedBook = collectionBooks[1];
        const baseAccount = createAccount(book, 'base-hist', 'Cash Hist');
        const connectedAccount = createAccount(
            connectedBook,
            'connected-hist',
            'Cash Hist',
            AccountType.ASSET,
            { exc_account: 'New Exchange' }
        );
        const matchingGroup = createGroup(book, 'eur-group', 'EUR', [baseAccount]);
        const exchangeGroupOne = new Group(book, { id: 'exchange-group-1', name: 'Exchange One' });
        const exchangeGroupOneDuplicate = new Group(book, {
            id: 'exchange-group-1',
            name: 'Exchange One',
        });
        const exchangeGroupTwo = new Group(book, { id: 'exchange-group-2', name: 'Exchange Two' });
        const exchangeOne = createAccount(book, 'exchange-1', 'Exchange_One');
        const exchangeTwo = createAccount(book, 'exchange-2', 'Other EXC');
        const exchangeThree = createAccount(book, 'exchange-3', 'Duplicate EXC');
        exchangeOne.getGroups = async () => [exchangeGroupOne];
        exchangeTwo.getGroups = async () => [exchangeGroupTwo];
        exchangeThree.getGroups = async () => [exchangeGroupOneDuplicate];
        const accounts = new Map([
            ['Cash Hist', baseAccount],
            ['Exchange_One', exchangeOne],
            ['Other EXC', exchangeTwo],
            ['Duplicate EXC', exchangeThree],
        ]);
        const baseQueries: string[] = [];
        const connectedQueries: string[] = [];
        book.getGroup = async code => (code == 'EUR' ? matchingGroup : undefined);
        book.getGroups = async () => [];
        book.getAccounts = async () => [baseAccount, exchangeOne, exchangeTwo, exchangeThree];
        book.getAccount = async name => {
            const account = accounts.get(name ?? '');
            if (account) {
                return account;
            }
            throw new BkperError(404, 'Account not found', 'notFound');
        };
        book.getBalancesReport = async query => {
            baseQueries.push(query);
            return createReport(
                book,
                query.startsWith('before:') ? new Map([[baseAccount, '150']]) : new Map()
            );
        };
        connectedBook.getAccount = async name =>
            name == connectedAccount.getName() ? connectedAccount : undefined;
        connectedBook.getBalancesReport = async query => {
            connectedQueries.push(query);
            return createReport(
                connectedBook,
                query.startsWith('before:') ? new Map([[connectedAccount, '100']]) : new Map()
            );
        };

        let createdAccount: bkper.Account | undefined;
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            if (!request.body) {
                throw new Error(`Unexpected request: ${request.method} ${request.url}`);
            }
            const payload = (await request.json()) as bkper.Account;
            createdAccount = { ...payload, id: 'new-exchange' };
            return Response.json(createdAccount);
        }) as typeof fetch;
        let accepted: Transaction[] = [];
        book.batchCreateTransactions = async transactions => {
            accepted = transactions;
            return transactions;
        };
        book.audit = () => undefined;

        const result = await ExchangeUpdateService.update(
            createContext(book),
            'usd-book',
            rates({ EUR: '0.5' })
        );

        expect(baseQueries).toEqual(['after:2026-02-01 before:2026-08-06', 'before:2026-08-06']);
        expect(connectedQueries).toEqual([
            'after:2026-02-01 before:2026-08-06',
            'before:2026-08-06',
        ]);
        if (!createdAccount) {
            throw new Error('Expected the Exchange Account to be created');
        }
        expect(createdAccount).toMatchObject({
            id: 'new-exchange',
            name: 'New Exchange',
            type: AccountType.ASSET,
            groups: [{ id: 'exchange-group-1' }, { id: 'exchange-group-2' }],
        });
        expect(accepted[0].json()).toMatchObject({
            amount: '50',
            description: '#exchange_gain_hist',
            creditAccount: { id: 'new-exchange' },
            debitAccount: { id: 'base-hist' },
        });
        expect(result.createdTransactions).toHaveLength(1);
        expect(result.createdAccounts).toEqual([createdAccount]);
    });

    test('skips Hist accounts when the Book is historical', async () => {
        const book = createBook(
            'usd-book',
            'USD',
            { exc_historical: 'true' },
            {
                collection: {
                    books: [
                        { id: 'usd-book', properties: { exc_code: 'USD' } },
                        { id: 'eur-book', properties: { exc_code: 'EUR' } },
                    ],
                },
            }
        );
        const collection = book.getCollection()!;
        const collectionBooks = collection.getBooks();
        collection.getBooks = () => collectionBooks;
        const connectedBook = collectionBooks[1];
        const baseAccount = createAccount(book, 'base-hist', 'Cash Hist');
        const connectedAccount = createAccount(connectedBook, 'connected-hist', 'Cash Hist');
        const matchingGroup = createGroup(book, 'eur-group', 'EUR', [baseAccount]);
        const baseQueries: string[] = [];
        const connectedQueries: string[] = [];
        book.getGroup = async () => matchingGroup;
        book.getGroups = async () => [];
        book.getBalancesReport = async query => {
            baseQueries.push(query);
            return createReport(book, new Map([[baseAccount, '150']]));
        };
        connectedBook.getAccount = async () => connectedAccount;
        connectedBook.getBalancesReport = async query => {
            connectedQueries.push(query);
            return createReport(connectedBook, new Map([[connectedAccount, '100']]));
        };
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            throw new Error(`Unexpected request: ${input.toString()}`);
        }) as unknown as typeof fetch;
        let batched: Transaction[] = [];
        book.batchCreateTransactions = async transactions => {
            batched = transactions;
            return transactions;
        };
        let audited = false;
        book.audit = () => {
            audited = true;
        };

        const result = await ExchangeUpdateService.update(
            createContext(book),
            'usd-book',
            rates({ EUR: '0.5' })
        );

        expect(baseQueries).toEqual(['before:2026-08-06']);
        expect(connectedQueries).toEqual(['before:2026-08-06']);
        expect(batched).toEqual([]);
        expect(result).toEqual({ createdTransactions: [], createdAccounts: [] });
        expect(audited).toBe(true);
    });
});
