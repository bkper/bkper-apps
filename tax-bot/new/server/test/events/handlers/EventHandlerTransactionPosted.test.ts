import { describe, expect, test } from 'bun:test';
import { Amount, Bkper, Book, type Transaction } from 'bkper-js';
import { AppContext } from '../../../src/AppContext';
import { TAX_EXCLUDED_RATE_PROP } from '../../../src/constants';
import EventHandlerTransactionPosted from '../../../src/events/handlers/EventHandlerTransactionPosted';

class TaxSourceHandler extends EventHandlerTransactionPosted {
    readonly lookupOrder: string[] = [];

    getTaxRate(book: Book, accountOrGroup: bkper.Account | bkper.Group, included: boolean): Amount {
        return this.getTaxRateFromAccountOrGroup_(book, accountOrGroup, included);
    }

    protected getTaxRateFromAccountOrGroup_(
        book: Book,
        accountOrGroup: bkper.Account | bkper.Group,
        included: boolean
    ): Amount {
        this.lookupOrder.push(`${included ? 'included' : 'excluded'}:${accountOrGroup.id}`);
        return super.getTaxRateFromAccountOrGroup_(book, accountOrGroup, included);
    }

    calculateFullTaxAmount(
        book: Book,
        creditAccount: bkper.Account,
        debitAccount: bkper.Account,
        included: boolean,
        transaction: bkper.Transaction
    ): Promise<Amount> {
        return this.getFullTaxAmount_(book, creditAccount, debitAccount, included, transaction);
    }

    buildTaxTransactions(
        book: Book,
        account: bkper.Account,
        contraAccount: bkper.Account,
        transaction: bkper.Transaction,
        netAmount: Amount
    ): Transaction[] {
        return this.getTaxTransactions(book, account, contraAccount, transaction, netAmount);
    }

    buildTaxTransaction(
        book: Book,
        accountOrGroup: bkper.Account | bkper.Group,
        accountName: string,
        contraAccountName: string,
        transaction: bkper.Transaction,
        taxProperty: string,
        netAmount: Amount
    ): Transaction | null {
        return this.createTaxTransaction(
            book,
            accountOrGroup,
            accountName,
            contraAccountName,
            transaction,
            taxProperty,
            netAmount
        );
    }
}

class NetRecordingHandler extends EventHandlerTransactionPosted {
    readonly constructionOrder: string[] = [];
    readonly netAmounts: string[] = [];

    protected getTaxTransactions(
        _book: Book,
        account: bkper.Account,
        _contraAccount: bkper.Account,
        _transaction: bkper.Transaction,
        netAmount: Amount
    ): Transaction[] {
        this.constructionOrder.push(account.id!);
        this.netAmounts.push(netAmount.toString());
        return [];
    }
}

function createBook(overrides: Partial<bkper.Book> = {}): Book {
    return new Book({
        id: 'book-1',
        name: 'Tax Book',
        decimalSeparator: 'DOT',
        fractionDigits: 2,
        ...overrides,
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
        id: 'transaction-1',
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

function createEvent(transaction: bkper.Transaction, eventAgentId = 'tester'): bkper.Event {
    return {
        type: 'TRANSACTION_POSTED',
        book: createBook().json(),
        user: { username: 'tester' },
        agent: { id: eventAgentId },
        data: { object: { transaction } },
    };
}

function createHandler(): TaxSourceHandler {
    return new TaxSourceHandler(new AppContext(new Bkper()));
}

function createNetRecordingHandler(): NetRecordingHandler {
    return new NetRecordingHandler(new AppContext(new Bkper()));
}

describe('legacy tax source discovery', () => {
    test('skips Tax Bot from the Transaction agent field before source discovery', async () => {
        const handler = createHandler();

        const result = await handler.handleEvent(
            createEvent(createTransaction({ agentId: 'sales-tax-bot' }), 'other-agent')
        );

        expect(result).toBe(false);
        expect(handler.lookupOrder).toEqual([]);
    });

    test('does not use the Event agent field for the Tax Bot guard', async () => {
        const handler = createHandler();

        await handler.handleEvent(
            createEvent(createTransaction({ agentId: 'other-agent' }), 'sales-tax-bot')
        );

        expect(handler.lookupOrder.length).toBeGreaterThan(0);
    });

    test('discovers origin before destination and Account before embedded Groups', async () => {
        const handler = createHandler();
        const origin = createAccount('origin', {}, [
            { id: 'origin-group-1', properties: {} },
            { id: 'origin-group-2', properties: {} },
        ]);
        const destination = createAccount('destination', {}, [
            { id: 'destination-group-1', properties: {} },
        ]);

        await handler.handleEvent(
            createEvent(
                createTransaction({
                    creditAccount: origin,
                    debitAccount: destination,
                })
            )
        );

        expect(handler.lookupOrder).toEqual([
            'excluded:origin',
            'excluded:origin-group-1',
            'excluded:origin-group-2',
            'excluded:destination',
            'excluded:destination-group-1',
            'included:origin',
            'included:origin-group-1',
            'included:origin-group-2',
            'included:destination',
            'included:destination-group-1',
        ]);
    });

    const RATE_CASES: readonly {
        name: string;
        properties: Record<string, string>;
        included: boolean;
        expected: string;
    }[] = [
        {
            name: 'uses the current included rate before its deprecated alias',
            properties: { tax_included_rate: '12', tax_included: '8' },
            included: true,
            expected: '12',
        },
        {
            name: 'falls back to the deprecated included rate',
            properties: { tax_included_rate: '', tax_included: '8' },
            included: true,
            expected: '8',
        },
        {
            name: 'uses the current excluded rate before its deprecated alias',
            properties: { tax_excluded_rate: '7', tax_excluded: '3' },
            included: false,
            expected: '7',
        },
        {
            name: 'treats a positive legacy tax_rate as included only',
            properties: { tax_rate: '15' },
            included: false,
            expected: '0',
        },
        {
            name: 'returns a positive legacy tax_rate for included discovery',
            properties: { tax_rate: '15' },
            included: true,
            expected: '15',
        },
        {
            name: 'treats a negative legacy tax_rate as excluded only',
            properties: { tax_rate: '-15' },
            included: true,
            expected: '0',
        },
        {
            name: 'returns a negative legacy tax_rate for excluded discovery',
            properties: { tax_rate: '-15' },
            included: false,
            expected: '-15',
        },
        {
            name: 'preserves a negative current included rate',
            properties: { tax_included_rate: '-5' },
            included: true,
            expected: '-5',
        },
        {
            name: 'preserves a zero current included rate',
            properties: { tax_included_rate: '0' },
            included: true,
            expected: '0',
        },
        {
            name: 'returns zero for a missing rate',
            properties: {},
            included: true,
            expected: '0',
        },
    ];

    for (const rateCase of RATE_CASES) {
        test(rateCase.name, () => {
            const handler = createHandler();

            const result = handler.getTaxRate(
                createBook(),
                createAccount('source', rateCase.properties),
                rateCase.included
            );

            expect(result.toString()).toBe(rateCase.expected);
        });
    }

    test('preserves the empty legacy tax_rate parsing failure', () => {
        const handler = createHandler();

        expect(() =>
            handler.getTaxRate(
                createBook(),
                createAccount('source', { tax_rate: '', tax_included_rate: '12' }),
                true
            )
        ).toThrow('[big.js] Invalid number');
    });
});

describe('legacy tax calculation', () => {
    test('aggregates fixed amounts for each matching Account or Group exactly as legacy does', async () => {
        const handler = createHandler();
        const origin = createAccount('origin', { tax_included_rate: '10' }, [
            { id: 'included-group', properties: { tax_included: '5' } },
            { id: 'legacy-group', properties: { tax_rate: '-4' } },
        ]);
        const destination = createAccount('destination', { tax_excluded_rate: '8' });
        const transaction = createTransaction({
            creditAccount: origin,
            debitAccount: destination,
            properties: {
                tax_included_amount: '-7.50',
                tax_excluded_amount: '-3.25',
            },
        });

        const included = await handler.calculateFullTaxAmount(
            createBook(),
            origin,
            destination,
            true,
            transaction
        );
        const excluded = await handler.calculateFullTaxAmount(
            createBook(),
            origin,
            destination,
            false,
            transaction
        );

        expect(included.toString()).toBe('22.5');
        expect(excluded.toString()).toBe('3.25');
    });

    test('extracts aggregate included tax from the source amount', async () => {
        const handler = createNetRecordingHandler();
        const origin = createAccount('origin', { tax_included_rate: '20' });

        const result = await handler.handleEvent(
            createEvent(
                createTransaction({
                    amount: '120',
                    creditAccount: origin,
                })
            )
        );

        expect(result).toBe(false);
        expect(handler.constructionOrder).toEqual(['origin', 'destination']);
        expect(handler.netAmounts).toEqual(['100', '100']);
    });

    test('uses the aggregate fixed included amount instead of the included-rate formula', async () => {
        const handler = createNetRecordingHandler();
        const origin = createAccount('origin', { tax_included_rate: '20' });

        await handler.handleEvent(
            createEvent(
                createTransaction({
                    amount: '120',
                    creditAccount: origin,
                    properties: { tax_included_amount: '7' },
                })
            )
        );

        expect(handler.netAmounts).toEqual(['113', '113']);
    });

    test('rejects an aggregate included rate at the exact legacy boundary', async () => {
        const handler = createNetRecordingHandler();
        const origin = createAccount('origin', { tax_included_rate: '100' });

        const result = await handler.handleEvent(
            createEvent(createTransaction({ creditAccount: origin }))
        );

        expect(result).toBe('Cannot process more than 100% in total taxes. Sum of all taxes: 100');
        expect(handler.constructionOrder).toEqual([]);
    });

    test('returns before construction when all rates and fixed amounts are zero', async () => {
        const handler = createNetRecordingHandler();

        const result = await handler.handleEvent(createEvent(createTransaction()));

        expect(result).toBe(false);
        expect(handler.constructionOrder).toEqual([]);
    });
});

describe('legacy tax description and rounding', () => {
    const ROUND_CASES: readonly {
        name: string;
        round?: string;
        expected: string;
    }[] = [
        { name: 'accepts zero decimal places', round: '0', expected: '1' },
        { name: 'falls back for excessive decimal places', round: '9', expected: '1.23' },
        { name: 'falls back for an invalid value', round: 'invalid', expected: '1.23' },
        { name: 'falls back when tax_round is missing', expected: '1.23' },
    ];

    for (const roundCase of ROUND_CASES) {
        test(roundCase.name, () => {
            const handler = createHandler();
            const account = createAccount('configured', {
                tax_excluded_rate: '1.2345',
                tax_description: 'Tax movement',
            });
            const transaction = createTransaction({
                properties: roundCase.round == null ? {} : { tax_round: roundCase.round },
            });

            const taxTransaction = handler.buildTaxTransaction(
                createBook(),
                account,
                'origin',
                'destination',
                transaction,
                TAX_EXCLUDED_RATE_PROP,
                new Amount('100')
            );

            expect(taxTransaction).not.toBeNull();
            expect(taxTransaction!.getAmount()!.toString()).toBe(roundCase.expected);
        });
    }

    test('preserves negative tax_round rounding to positions left of the decimal', () => {
        const handler = createHandler();
        const account = createAccount('configured', { tax_excluded_rate: '12.345' });

        const taxTransaction = handler.buildTaxTransaction(
            createBook(),
            account,
            'origin',
            'destination',
            createTransaction({ properties: { tax_round: '-1' } }),
            TAX_EXCLUDED_RATE_PROP,
            new Amount('100')
        );

        expect(taxTransaction!.getAmount()!.toString()).toBe('10');
    });

    test('retains a constructed draft when a nonzero amount rounds to zero', () => {
        const handler = createHandler();
        const account = createAccount('configured', { tax_excluded_rate: '1' });

        const taxTransaction = handler.buildTaxTransaction(
            createBook(),
            account,
            'origin',
            'destination',
            createTransaction(),
            TAX_EXCLUDED_RATE_PROP,
            new Amount('0.4')
        );

        expect(taxTransaction).not.toBeNull();
        expect(taxTransaction!.getAmount()).toBeUndefined();
        expect(taxTransaction!.isPosted()).toBeUndefined();
    });

    test('preserves substitution order, side expansion, and first-occurrence replacement', () => {
        const handler = createHandler();
        const template =
            '${transaction.description}|${transaction.description}|${account.name}|${account.name}|${account.name.origin}|${account.name.destination}|${account.contra.name}|${account.contra.name.origin}|${account.contra.name.destination}';
        const origin = createAccount('origin', {
            tax_excluded_rate: '10',
            tax_description: template,
        });
        origin.name = 'Sales';
        const destination = createAccount('destination', {
            tax_excluded_rate: '10',
            tax_description: template,
        });
        destination.name = 'Cash';
        const transaction = createTransaction({
            description: 'Sale',
            creditAccount: origin,
            debitAccount: destination,
        });

        const originTax = handler.buildTaxTransaction(
            createBook(),
            origin,
            'Sales',
            'Cash',
            transaction,
            TAX_EXCLUDED_RATE_PROP,
            new Amount('100')
        );
        const destinationTax = handler.buildTaxTransaction(
            createBook(),
            destination,
            'Cash',
            'Sales',
            transaction,
            TAX_EXCLUDED_RATE_PROP,
            new Amount('100')
        );

        expect(originTax!.getDescription()).toBe(
            'Sale|${transaction.description}|Sales|${account.name}|Sales||Cash||Cash'
        );
        expect(destinationTax!.getDescription()).toBe(
            'Sale|${transaction.description}|Cash|${account.name}||Cash|Sales|Sales|'
        );
    });
});

describe('legacy tax Transaction construction', () => {
    test('preserves Account, Group, and tax-property construction order', () => {
        const handler = createHandler();
        const account = createAccount(
            'origin',
            {
                tax_rate: '1',
                tax_included_rate: '2',
                tax_included: '3',
                tax_excluded_rate: '4',
                tax_excluded: '5',
            },
            [
                {
                    id: 'group-1',
                    properties: {
                        tax_included_rate: '6',
                        tax_excluded_rate: '7',
                    },
                },
            ]
        );
        const transaction = createTransaction({ id: 'source-1', creditAccount: account });

        const taxTransactions = handler.buildTaxTransactions(
            createBook(),
            account,
            transaction.debitAccount!,
            transaction,
            new Amount('100')
        );

        expect(taxTransactions.map(taxTransaction => taxTransaction.getRemoteIds()[0])).toEqual([
            'tax_source-1_origin',
            'tax_included_rate_source-1_origin',
            'tax_included_source-1_origin',
            'tax_excluded_rate_source-1_origin',
            'tax_excluded_source-1_origin',
            'tax_included_rate_source-1_group-1',
            'tax_excluded_rate_source-1_group-1',
        ]);
    });

    test('preserves fixed-amount override matching when the configured rate is zero', () => {
        const handler = createHandler();
        const configuredAccount = createAccount('configured', { tax_excluded_rate: '0' });
        const emptyAccount = createAccount('empty', { tax_excluded_rate: '   ' });
        const transaction = createTransaction({
            properties: { tax_excluded_amount: '-4' },
        });

        const fixedTax = handler.buildTaxTransaction(
            createBook(),
            configuredAccount,
            'origin',
            'destination',
            transaction,
            TAX_EXCLUDED_RATE_PROP,
            new Amount('100')
        );
        const zeroTax = handler.buildTaxTransaction(
            createBook(),
            configuredAccount,
            'origin',
            'destination',
            createTransaction(),
            TAX_EXCLUDED_RATE_PROP,
            new Amount('100')
        );
        const emptyTax = handler.buildTaxTransaction(
            createBook(),
            emptyAccount,
            'origin',
            'destination',
            transaction,
            TAX_EXCLUDED_RATE_PROP,
            new Amount('100')
        );

        expect(fixedTax!.getAmount()!.toString()).toBe('4');
        expect(zeroTax).toBeNull();
        expect(emptyTax).toBeNull();
    });

    test('parses configured rates with the Book decimal separator', () => {
        const handler = createHandler();
        const account = createAccount('configured', { tax_excluded_rate: '12,5' });

        const taxTransaction = handler.buildTaxTransaction(
            createBook({ decimalSeparator: 'COMMA' }),
            account,
            'origin',
            'destination',
            createTransaction(),
            TAX_EXCLUDED_RATE_PROP,
            new Amount('100')
        );

        expect(taxTransaction!.getAmount()!.toString()).toBe('12.5');
    });

    test('preserves date, positive amount, remote id, and source property transformations', () => {
        const handler = createHandler();
        const account = createAccount('configured', {
            tax_excluded_rate: '-10',
            tax_description: 'Tax Payable >> Tax Expense',
        });
        const transaction = createTransaction({
            id: 'source-1',
            date: '2024-03-04',
            amount: '100',
            properties: {
                exc_code: 'USD',
                exc_date: '2024-03-01',
                exc_rate: '2',
                exc_amount: '300',
                tax_round: '2',
                tax_included_amount: '4',
                tax_excluded_amount: '5',
                visible: 'copied',
                hidden_: 'not copied',
            },
        });

        const taxTransaction = handler.buildTaxTransaction(
            createBook(),
            account,
            'origin',
            'destination',
            transaction,
            TAX_EXCLUDED_RATE_PROP,
            new Amount('100')
        );
        const payload = taxTransaction!.json();

        expect(payload.date).toBe('2024-03-04');
        expect(payload.amount).toBe('5');
        expect(payload.description).toBe('Tax Payable >> Tax Expense');
        expect(payload.remoteIds).toEqual(['tax_excluded_rate_source-1_configured']);
        expect(payload.properties).toEqual({
            exc_code: 'USD',
            exc_date: '2024-03-01',
            exc_rate: '3',
            visible: 'copied',
        });
    });

    test('preserves the zero exchange-amount fallback and empty exchange properties', () => {
        const handler = createHandler();
        const account = createAccount('configured', { tax_excluded_rate: '10' });
        const transaction = createTransaction({
            properties: { exc_rate: '2', exc_amount: '0' },
        });

        const taxTransaction = handler.buildTaxTransaction(
            createBook(),
            account,
            'origin',
            'destination',
            transaction,
            TAX_EXCLUDED_RATE_PROP,
            new Amount('100')
        );

        expect(taxTransaction!.getProperties()).toEqual({
            exc_code: '',
            exc_date: '',
            exc_rate: '',
            exc_amount: '0',
        });
    });

    test('leaves Account resolution to Bkper without assigning a partial movement', () => {
        const handler = createHandler();
        const account = createAccount('configured', {
            tax_excluded_rate: '10',
            tax_description: 'Tax Payable >> Missing Account',
        });

        const taxTransaction = handler.buildTaxTransaction(
            createBook(),
            account,
            'origin',
            'destination',
            createTransaction(),
            TAX_EXCLUDED_RATE_PROP,
            new Amount('100')
        );
        const payload = taxTransaction!.json();

        expect(payload.amount).toBe('10');
        expect(payload.creditAccount).toBeUndefined();
        expect(payload.debitAccount).toBeUndefined();
        expect(payload.posted).toBeUndefined();
    });
});
