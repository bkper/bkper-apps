import { describe, expect, test } from 'bun:test';
import { Account, AccountType, Book, Transaction } from 'bkper-js';
import { CalculateRealizedResultsProcessor } from '../../../../src/api/services/calculate/calculate-realized-results-processor.js';
import { CalculateRealizedResultsService } from '../../../../src/api/services/calculate/calculate-realized-results-service.js';
import { CalculationModel } from '../../../../src/api/services/calculate/types.js';
import { StockAccount } from '../../../../src/api/services/stock-account.js';
import { Summary } from '../../../../src/api/services/summary.js';

interface ResultCall {
    transaction: Transaction;
    gain: string;
    gainBaseNoFx: string;
    historical: boolean;
}

interface MtmCall {
    transaction: Transaction;
    price: string;
    historical: boolean;
}

interface SupportCalls {
    realized: ResultCall[];
    fx: ResultCall[];
    mtm: MtmCall[];
    order: string[];
}

function createBooks(): { stockBook: Book; financialBook: Book; baseBook: Book } {
    const collection: bkper.Collection = {
        books: [
            {
                id: 'base',
                name: 'Base',
                fractionDigits: 2,
                properties: { exc_base: 'true', exc_code: 'USD' },
            },
            {
                id: 'financial',
                name: 'Financial',
                fractionDigits: 2,
                properties: { exc_code: 'EUR' },
            },
        ],
    };
    return {
        stockBook: new Book({
            id: 'portfolio',
            name: 'Portfolio',
            fractionDigits: 0,
            datePattern: 'yyyy-MM-dd',
            timeZone: 'UTC',
        }),
        financialBook: new Book({
            id: 'financial',
            name: 'Financial',
            fractionDigits: 2,
            datePattern: 'yyyy-MM-dd',
            timeZone: 'UTC',
            properties: { exc_code: 'EUR' },
            collection,
        }),
        baseBook: new Book({
            id: 'base',
            name: 'Base',
            fractionDigits: 2,
            datePattern: 'yyyy-MM-dd',
            timeZone: 'UTC',
            properties: { exc_base: 'true', exc_code: 'USD' },
            collection,
        }),
    };
}

function createAccounts(stockBook: Book): {
    buy: Account;
    sell: Account;
    instrument: Account;
    stockAccount: StockAccount;
} {
    const buy = new Account(stockBook, {
        id: 'buy',
        name: 'Buy',
        type: AccountType.INCOMING,
    });
    const sell = new Account(stockBook, {
        id: 'sell',
        name: 'Sell',
        type: AccountType.OUTGOING,
    });
    const instrument = new Account(stockBook, {
        id: 'instrument',
        name: 'ACME',
        type: AccountType.ASSET,
    });
    const accounts = [buy, sell, instrument];
    stockBook.getAccount = async idOrName =>
        accounts.find(account => account.getId() === idOrName || account.getName() === idOrName);
    return { buy, sell, instrument, stockAccount: new StockAccount(instrument) };
}

function createOrder(
    book: Book,
    id: string,
    date: string,
    amount: string,
    creditAccount: Account,
    debitAccount: Account,
    properties: Record<string, string>
): Transaction {
    return new Transaction(book, {
        id,
        date,
        dateValue: +date.replaceAll('-', ''),
        amount,
        posted: true,
        checked: false,
        description: id,
        creditAccount: creditAccount.json(),
        debitAccount: debitAccount.json(),
        properties,
    });
}

function saleProperties(historicalPrice: string, fairPrice: string): Record<string, string> {
    return {
        order: '1',
        sale_price_hist: historicalPrice,
        sale_price: historicalPrice,
        fwd_sale_price: fairPrice,
        trade_exc_rate_hist: '2',
        trade_exc_rate: '3',
    };
}

function purchaseProperties(historicalPrice: string, fairPrice: string): Record<string, string> {
    return {
        order: '1',
        purchase_price_hist: historicalPrice,
        purchase_price: historicalPrice,
        fwd_purchase_price: fairPrice,
        trade_exc_rate_hist: '2',
        trade_exc_rate: '3',
    };
}

function stubSupport(
    service: CalculateRealizedResultsService,
    financialBook: Book,
    baseBook: Book
): SupportCalls {
    const support = service['support'];
    const unrealizedAccount = new Account(financialBook, {
        id: 'unrealized',
        name: 'ACME Unrealized',
        type: AccountType.ASSET,
    });
    const unrealizedHistAccount = new Account(financialBook, {
        id: 'unrealized-hist',
        name: 'ACME Unrealized Hist',
        type: AccountType.ASSET,
    });
    const unrealizedFxBaseAccount = new Account(baseBook, {
        id: 'unrealized-fx',
        name: 'ACME Unrealized EXC',
        type: AccountType.ASSET,
    });
    const unrealizedFxHistBaseAccount = new Account(baseBook, {
        id: 'unrealized-fx-hist',
        name: 'ACME Unrealized Hist EXC',
        type: AccountType.ASSET,
    });
    const calls: SupportCalls = { realized: [], fx: [], mtm: [], order: [] };

    support.getUnrealizedAccount = async () => unrealizedAccount;
    support.getUnrealizedHistAccount = async () => unrealizedHistAccount;
    support.getUnrealizedFxBaseAccount = async () => unrealizedFxBaseAccount;
    support.getUnrealizedFxHistBaseAccount = async () => unrealizedFxHistBaseAccount;
    support.addRealizedResult = async (
        _baseBook,
        _stockAccount,
        _financialBook,
        _unrealizedAccount,
        transaction,
        gain,
        gainBaseNoFx,
        historical
    ) => {
        calls.realized.push({
            transaction,
            gain: gain.toString(),
            gainBaseNoFx: gainBaseNoFx.toString(),
            historical,
        });
        calls.order.push(
            `realized:${historical ? 'hist' : 'standard'}:${transaction.getId() ?? 'split'}:${gain}`
        );
    };
    support.addFxResult = async (
        _stockAccount,
        _stockExcCode,
        _baseBook,
        _unrealizedFxAccount,
        transaction,
        gainBaseWithFx,
        gainBaseNoFx,
        _summary,
        historical
    ) => {
        calls.fx.push({
            transaction,
            gain: gainBaseWithFx.toString(),
            gainBaseNoFx: gainBaseNoFx.toString(),
            historical,
        });
        calls.order.push(
            `fx:${historical ? 'hist' : 'standard'}:${transaction.getId() ?? 'split'}:${gainBaseWithFx}`
        );
    };
    support.addMarkToMarket = async (
        _stockBook,
        transaction,
        _stockAccount,
        _financialBook,
        _unrealizedAccount,
        price,
        historical
    ) => {
        calls.mtm.push({ transaction, price: price.toString(), historical });
        calls.order.push(
            `mtm:${historical ? 'hist' : 'standard'}:${transaction.getId() ?? 'split'}:${price}`
        );
    };

    return calls;
}

function capturePortfolioBatches(stockBook: Book): {
    created: Transaction[];
    updated: Transaction[];
} {
    const result: { created: Transaction[]; updated: Transaction[] } = {
        created: [],
        updated: [],
    };
    stockBook.batchCreateTransactions = async transactions => {
        result.created.push(...transactions);
        return transactions;
    };
    stockBook.batchUpdateTransactions = async transactions => {
        result.updated.push(...transactions);
        return transactions;
    };
    return result;
}

async function movement(transaction: Transaction): Promise<{
    from: string | undefined;
    to: string | undefined;
}> {
    return {
        from: (await transaction.getCreditAccount())?.getName(),
        to: (await transaction.getDebitAccount())?.getName(),
    };
}

describe('legacy Calculate processSale behavior', () => {
    test('processes multiple long lots, including a partial lot, in the combined model', async () => {
        const { stockBook, financialBook, baseBook } = createBooks();
        const { buy, sell, instrument, stockAccount } = createAccounts(stockBook);
        const sale = createOrder(
            stockBook,
            'sale',
            '2025-03-01',
            '6',
            instrument,
            sell,
            saleProperties('12', '15')
        );
        const firstPurchase = createOrder(
            stockBook,
            'purchase-1',
            '2025-01-01',
            '4',
            buy,
            instrument,
            purchaseProperties('8', '10')
        );
        const secondPurchase = createOrder(
            stockBook,
            'purchase-2',
            '2025-02-01',
            '5',
            buy,
            instrument,
            purchaseProperties('9', '11')
        );
        const service = new CalculateRealizedResultsService();
        const calls = stubSupport(service, financialBook, baseBook);
        const batches = capturePortfolioBatches(stockBook);
        const processor = new CalculateRealizedResultsProcessor(stockBook, financialBook, baseBook);

        await service['processSale'](
            baseBook,
            financialBook,
            'EUR',
            stockBook,
            stockAccount,
            sale,
            [firstPurchase, secondPurchase],
            new Summary(),
            true,
            CalculationModel.BOTH,
            processor
        );
        await processor.fireBatchOperations();

        expect(firstPurchase.isChecked()).toBe(true);
        expect(firstPurchase.getAmount()?.toString()).toBe('4');
        expect(secondPurchase.isChecked()).toBe(false);
        expect(secondPurchase.getAmount()?.toString()).toBe('3');
        expect(sale.isChecked()).toBe(true);
        expect(sale.getProperty('purchase_amount')).toBe('50');
        expect(sale.getProperty('sale_amount')).toBe('72');
        expect(sale.getProperty('gain_amount_hist')).toBe('22');
        expect(sale.getProperty('gain_amount')).toBe('28');
        expect(sale.getProperty('fwd_purchase_amount')).toBe('62');
        expect(sale.getProperty('fwd_sale_amount')).toBe('90');
        expect(JSON.parse(sale.getProperty('purchase_log')!)).toHaveLength(2);
        expect(JSON.parse(sale.getProperty('fwd_purchase_log')!)).toHaveLength(2);

        expect(batches.created).toHaveLength(1);
        const splitPurchase = batches.created[0]!;
        expect(splitPurchase.getAmount()?.toString()).toBe('2');
        expect(splitPurchase.isChecked()).toBe(true);
        expect(splitPurchase.getProperty('parent_id')).toBe('purchase-2');
        expect(await movement(splitPurchase)).toEqual({ from: 'Buy', to: 'ACME' });
        expect(batches.updated).toEqual([firstPurchase, secondPurchase, sale]);

        expect(
            calls.realized.map(call => ({
                transaction: call.transaction.getId(),
                gain: call.gain,
                gainBaseNoFx: call.gainBaseNoFx,
                historical: call.historical,
            }))
        ).toEqual([
            { transaction: 'sale', gain: '22', gainBaseNoFx: '44', historical: true },
            { transaction: 'sale', gain: '28', gainBaseNoFx: '84', historical: false },
        ]);
        expect(calls.fx.map(call => call.historical)).toEqual([true, false]);
        expect(calls.mtm.map(call => ({ price: call.price, historical: call.historical }))).toEqual(
            [
                { price: '12', historical: true },
                { price: '12', historical: false },
            ]
        );
    });

    test('splits an incompletely matched long sale and associates historical results to the split', async () => {
        const { stockBook, financialBook, baseBook } = createBooks();
        const { buy, sell, instrument, stockAccount } = createAccounts(stockBook);
        const sale = createOrder(
            stockBook,
            'sale',
            '2025-03-01',
            '5',
            instrument,
            sell,
            saleProperties('10', '10')
        );
        const purchase = createOrder(
            stockBook,
            'purchase',
            '2025-01-01',
            '2',
            buy,
            instrument,
            purchaseProperties('6', '6')
        );
        const service = new CalculateRealizedResultsService();
        const calls = stubSupport(service, financialBook, baseBook);
        const batches = capturePortfolioBatches(stockBook);
        const processor = new CalculateRealizedResultsProcessor(stockBook, financialBook, baseBook);

        await service['processSale'](
            baseBook,
            financialBook,
            'EUR',
            stockBook,
            stockAccount,
            sale,
            [purchase],
            new Summary(),
            false,
            CalculationModel.HISTORICAL_ONLY,
            processor
        );
        await processor.fireBatchOperations();

        expect(purchase.isChecked()).toBe(true);
        expect(sale.isChecked()).toBe(false);
        expect(sale.getAmount()?.toString()).toBe('3');
        expect(batches.created).toHaveLength(1);
        const splitSale = batches.created[0]!;
        expect(splitSale.getAmount()?.toString()).toBe('2');
        expect(splitSale.isChecked()).toBe(true);
        expect(splitSale.getProperty('parent_id')).toBe('sale');
        expect(splitSale.getProperty('gain_amount')).toBe('8');
        expect(await movement(splitSale)).toEqual({ from: 'ACME', to: 'Sell' });
        expect(calls.realized).toHaveLength(1);
        expect(calls.realized[0]).toMatchObject({
            transaction: splitSale,
            gain: '8',
            gainBaseNoFx: '16',
            historical: false,
        });
        expect(calls.fx).toHaveLength(1);
        expect(calls.fx[0]!.transaction).toBe(splitSale);
        expect(calls.mtm).toHaveLength(0);
    });

    test('preserves short-sale liquidation and fair-only result behavior', async () => {
        const { stockBook, financialBook, baseBook } = createBooks();
        const { buy, sell, instrument, stockAccount } = createAccounts(stockBook);
        const sale = createOrder(
            stockBook,
            'sale',
            '2025-01-01',
            '2',
            instrument,
            sell,
            saleProperties('10', '11')
        );
        const purchase = createOrder(
            stockBook,
            'purchase',
            '2025-02-01',
            '2',
            buy,
            instrument,
            purchaseProperties('12', '13')
        );
        const service = new CalculateRealizedResultsService();
        const calls = stubSupport(service, financialBook, baseBook);
        const batches = capturePortfolioBatches(stockBook);
        const processor = new CalculateRealizedResultsProcessor(stockBook, financialBook, baseBook);

        await service['processSale'](
            baseBook,
            financialBook,
            'EUR',
            stockBook,
            stockAccount,
            sale,
            [purchase],
            new Summary(),
            true,
            CalculationModel.FAIR_ONLY,
            processor
        );
        await processor.fireBatchOperations();

        expect(batches.created).toHaveLength(0);
        expect(purchase.isChecked()).toBe(true);
        expect(purchase.getProperty('short_sale')).toBe('true');
        expect(purchase.getProperty('sale_date')).toBe('2025-01-01');
        expect(purchase.getProperty('gain_amount')).toBe('-4');
        expect(sale.isChecked()).toBe(true);
        expect(JSON.parse(sale.getProperty('liquidation_log')!)).toEqual([
            {
                id: 'purchase',
                dt: '2025-02-01',
                qt: '2',
                pr: '12',
                rt: '2',
            },
        ]);
        expect(
            calls.realized.map(call => ({
                transaction: call.transaction.getId(),
                gain: call.gain,
                historical: call.historical,
            }))
        ).toEqual([
            { transaction: 'purchase', gain: '-4', historical: false },
            { transaction: 'sale', gain: '0', historical: false },
        ]);
        expect(calls.fx).toHaveLength(2);
        expect(
            calls.mtm.map(call => ({
                transaction: call.transaction.getId(),
                price: call.price,
                historical: call.historical,
            }))
        ).toEqual([{ transaction: 'purchase', price: '12', historical: false }]);
    });

    test('preserves combined short-sale order across complete and partial purchase matches', async () => {
        const { stockBook, financialBook, baseBook } = createBooks();
        const { buy, sell, instrument, stockAccount } = createAccounts(stockBook);
        const sale = createOrder(
            stockBook,
            'sale',
            '2025-01-01',
            '3',
            instrument,
            sell,
            saleProperties('10', '11')
        );
        const firstPurchase = createOrder(
            stockBook,
            'purchase-1',
            '2025-02-01',
            '1',
            buy,
            instrument,
            purchaseProperties('12', '13')
        );
        const secondPurchase = createOrder(
            stockBook,
            'purchase-2',
            '2025-03-01',
            '5',
            buy,
            instrument,
            purchaseProperties('14', '15')
        );
        const service = new CalculateRealizedResultsService();
        const calls = stubSupport(service, financialBook, baseBook);
        const batches = capturePortfolioBatches(stockBook);
        const processor = new CalculateRealizedResultsProcessor(stockBook, financialBook, baseBook);

        await service['processSale'](
            baseBook,
            financialBook,
            'EUR',
            stockBook,
            stockAccount,
            sale,
            [firstPurchase, secondPurchase],
            new Summary(),
            true,
            CalculationModel.BOTH,
            processor
        );
        await processor.fireBatchOperations();

        expect(firstPurchase.isChecked()).toBe(true);
        expect(secondPurchase.isChecked()).toBe(false);
        expect(secondPurchase.getAmount()?.toString()).toBe('3');
        expect(batches.created).toHaveLength(1);
        const splitPurchase = batches.created[0]!;
        expect(splitPurchase.isChecked()).toBe(true);
        expect(splitPurchase.getAmount()?.toString()).toBe('2');
        expect(splitPurchase.getProperty('parent_id')).toBe('purchase-2');
        expect(splitPurchase.getProperty('short_sale')).toBe('true');
        expect(splitPurchase.getProperty('gain_amount_hist')).toBe('-8');
        expect(splitPurchase.getProperty('gain_amount')).toBe('-8');
        expect(await movement(splitPurchase)).toEqual({ from: 'Buy', to: 'ACME' });
        expect(JSON.parse(sale.getProperty('liquidation_log')!)).toEqual([
            { id: 'purchase-1', dt: '2025-02-01', qt: '1', pr: '12', rt: '2' },
            { dt: '2025-03-01', qt: '2', pr: '14', rt: '2' },
        ]);
        expect(calls.order).toEqual([
            'realized:hist:purchase-1:-2',
            'realized:standard:purchase-1:-2',
            'fx:hist:purchase-1:-4',
            'fx:standard:purchase-1:-6',
            'mtm:hist:purchase-1:12',
            'mtm:standard:purchase-1:12',
            'realized:hist:split:-8',
            'realized:standard:split:-8',
            'fx:hist:split:-16',
            'fx:standard:split:-24',
            'mtm:hist:split:14',
            'mtm:standard:split:14',
            'realized:hist:sale:0',
            'realized:standard:sale:0',
            'fx:hist:sale:0',
            'fx:standard:sale:0',
        ]);
    });

    test('skips checked purchases without creating a split or marking the sale calculated', async () => {
        const { stockBook, financialBook, baseBook } = createBooks();
        const { buy, sell, instrument, stockAccount } = createAccounts(stockBook);
        const sale = createOrder(
            stockBook,
            'sale',
            '2025-03-01',
            '2',
            instrument,
            sell,
            saleProperties('10', '11')
        );
        const checkedPurchase = createOrder(
            stockBook,
            'purchase',
            '2025-01-01',
            '2',
            buy,
            instrument,
            purchaseProperties('6', '7')
        ).setChecked(true);
        const service = new CalculateRealizedResultsService();
        const calls = stubSupport(service, financialBook, baseBook);
        const batches = capturePortfolioBatches(stockBook);
        const processor = new CalculateRealizedResultsProcessor(stockBook, financialBook, baseBook);

        await service['processSale'](
            baseBook,
            financialBook,
            'EUR',
            stockBook,
            stockAccount,
            sale,
            [checkedPurchase],
            new Summary(),
            true,
            CalculationModel.HISTORICAL_ONLY,
            processor
        );
        await processor.fireBatchOperations();

        expect(checkedPurchase.isChecked()).toBe(true);
        expect(sale.isChecked()).toBe(false);
        expect(sale.getAmount()?.toString()).toBe('2');
        expect(batches.created).toHaveLength(0);
        expect(batches.updated).toHaveLength(0);
        expect(calls.order).toEqual(['realized:standard:sale:0', 'fx:standard:sale:0']);
    });

    test('preserves date and price fallback properties for a complete fair-value long sale', async () => {
        const { stockBook, financialBook, baseBook } = createBooks();
        const { buy, sell, instrument, stockAccount } = createAccounts(stockBook);
        const sale = createOrder(stockBook, 'sale', '2025-03-01', '2', instrument, sell, {
            order: '1',
            date: '2025-03-05',
            price: '10',
            trade_exc_rate_hist: '2',
            trade_exc_rate: '3',
        });
        const purchase = createOrder(stockBook, 'purchase', '2025-01-01', '2', buy, instrument, {
            order: '1',
            date: '2024-12-31',
            price: '6',
            trade_exc_rate_hist: '2',
            trade_exc_rate: '3',
        });
        const service = new CalculateRealizedResultsService();
        const calls = stubSupport(service, financialBook, baseBook);
        const batches = capturePortfolioBatches(stockBook);
        const processor = new CalculateRealizedResultsProcessor(stockBook, financialBook, baseBook);

        await service['processSale'](
            baseBook,
            financialBook,
            'EUR',
            stockBook,
            stockAccount,
            sale,
            [purchase],
            new Summary(),
            true,
            CalculationModel.FAIR_ONLY,
            processor
        );
        await processor.fireBatchOperations();

        expect(batches.created).toHaveLength(0);
        expect(purchase.getProperty('purchase_price')).toBe('6');
        expect(purchase.getProperty('purchase_amount')).toBe('12');
        expect(purchase.getProperty('fwd_purchase_amount')).toBe('12');
        expect(sale.getProperty('gain_amount')).toBe('8');
        expect(JSON.parse(sale.getProperty('purchase_log')!)).toEqual([
            { qt: '2', pr: '6', dt: '2024-12-31', rt: '2' },
        ]);
        expect(JSON.parse(sale.getProperty('fwd_purchase_log')!)).toEqual([
            { qt: '2', pr: '6', dt: '2024-12-31', rt: '3' },
        ]);
        expect(calls.order).toEqual([
            'realized:standard:sale:8',
            'fx:standard:sale:24',
            'mtm:standard:sale:10',
        ]);
    });

    test('uses Portfolio Book fraction digits when deciding that a residual sale is complete', async () => {
        const { stockBook, financialBook, baseBook } = createBooks();
        stockBook.setFractionDigits(2);
        const { buy, sell, instrument, stockAccount } = createAccounts(stockBook);
        const sale = createOrder(
            stockBook,
            'sale',
            '2025-03-01',
            '1.004',
            instrument,
            sell,
            saleProperties('10', '10')
        );
        const purchase = createOrder(
            stockBook,
            'purchase',
            '2025-01-01',
            '1',
            buy,
            instrument,
            purchaseProperties('6', '6')
        );
        const service = new CalculateRealizedResultsService();
        stubSupport(service, financialBook, baseBook);
        const batches = capturePortfolioBatches(stockBook);
        const processor = new CalculateRealizedResultsProcessor(stockBook, financialBook, baseBook);

        await service['processSale'](
            baseBook,
            financialBook,
            'EUR',
            stockBook,
            stockAccount,
            sale,
            [purchase],
            new Summary(),
            false,
            CalculationModel.HISTORICAL_ONLY,
            processor
        );
        await processor.fireBatchOperations();

        expect(sale.isChecked()).toBe(true);
        expect(sale.getAmount()?.toString()).toBe('1.004');
        expect(batches.created).toHaveLength(0);
        expect(batches.updated).toEqual([purchase, sale]);
    });

    test('preserves missing exchange rates when no Base Book is configured', async () => {
        const stockBook = new Book({
            id: 'portfolio',
            fractionDigits: 0,
            datePattern: 'yyyy-MM-dd',
            timeZone: 'UTC',
        });
        const financialBook = new Book({
            id: 'financial',
            fractionDigits: 2,
            datePattern: 'yyyy-MM-dd',
            timeZone: 'UTC',
            properties: { exc_code: 'EUR' },
        });
        const baseBook = new Book({
            id: 'base',
            fractionDigits: 2,
            datePattern: 'yyyy-MM-dd',
            timeZone: 'UTC',
            properties: { exc_code: 'USD' },
        });
        const { buy, sell, instrument, stockAccount } = createAccounts(stockBook);
        const sale = createOrder(stockBook, 'sale', '2025-03-01', '2', instrument, sell, {
            order: '1',
            sale_price: '10',
        });
        const purchase = createOrder(stockBook, 'purchase', '2025-01-01', '2', buy, instrument, {
            order: '1',
            purchase_price: '6',
        });
        const service = new CalculateRealizedResultsService();
        const calls = stubSupport(service, financialBook, baseBook);
        const processor = new CalculateRealizedResultsProcessor(stockBook, financialBook, baseBook);

        await service['processSale'](
            baseBook,
            financialBook,
            'EUR',
            stockBook,
            stockAccount,
            sale,
            [purchase],
            new Summary(),
            false,
            CalculationModel.HISTORICAL_ONLY,
            processor
        );

        expect(purchase.getProperty('purchase_exc_rate')).toBeUndefined();
        expect(sale.getProperty('sale_exc_rate')).toBeUndefined();
        expect(JSON.parse(sale.getProperty('purchase_log')!)).toEqual([
            { qt: '2', pr: '6', dt: '2025-01-01' },
        ]);
        expect(calls.realized).toHaveLength(1);
        expect(calls.realized[0]).toMatchObject({ gain: '8', gainBaseNoFx: '0' });
        expect(calls.fx).toHaveLength(1);
        expect(calls.fx[0]).toMatchObject({ gain: '0', gainBaseNoFx: '0' });
    });

    test('composes a long sale into complete realized and FX movements', async () => {
        const { stockBook, financialBook, baseBook } = createBooks();
        const { buy, sell, instrument, stockAccount } = createAccounts(stockBook);
        const sale = createOrder(
            stockBook,
            'sale',
            '2025-03-01',
            '2',
            instrument,
            sell,
            saleProperties('10', '10')
        ).setProperty('trade_exc_rate_hist', '3');
        const purchase = createOrder(
            stockBook,
            'purchase',
            '2025-01-01',
            '2',
            buy,
            instrument,
            purchaseProperties('6', '6')
        );
        const unrealized = new Account(financialBook, {
            id: 'unrealized',
            name: 'ACME Unrealized',
            type: AccountType.ASSET,
        });
        const realized = new Account(financialBook, {
            id: 'realized',
            name: 'ACME Realized',
            type: AccountType.INCOMING,
        });
        const unrealizedFx = new Account(baseBook, {
            id: 'unrealized-fx',
            name: 'ACME Unrealized EXC',
            type: AccountType.ASSET,
            properties: { exc_account: 'ACME Realized EXC' },
        });
        const realizedFx = new Account(baseBook, {
            id: 'realized-fx',
            name: 'ACME Realized EXC',
            type: AccountType.INCOMING,
        });
        const financialAccounts = [unrealized, realized];
        const baseAccounts = [unrealizedFx, realizedFx];
        financialBook.getAccount = async idOrName =>
            financialAccounts.find(
                account => account.getId() === idOrName || account.getName() === idOrName
            );
        baseBook.getAccount = async idOrName =>
            baseAccounts.find(
                account => account.getId() === idOrName || account.getName() === idOrName
            );
        const service = new CalculateRealizedResultsService();
        service['support'].getUnrealizedAccount = async () => unrealized;
        service['support'].getUnrealizedFxBaseAccount = async () => unrealizedFx;
        const processor = new CalculateRealizedResultsProcessor(stockBook, financialBook, baseBook);
        let financialTransactions: Transaction[] = [];
        let baseTransactions: Transaction[] = [];
        financialBook.batchCreateTransactions = async transactions => {
            financialTransactions = transactions;
            return transactions;
        };
        baseBook.batchCreateTransactions = async transactions => {
            baseTransactions = transactions;
            return transactions;
        };
        stockBook.batchUpdateTransactions = async transactions => transactions;

        await service['processSale'](
            baseBook,
            financialBook,
            'EUR',
            stockBook,
            stockAccount,
            sale,
            [purchase],
            new Summary(),
            false,
            CalculationModel.HISTORICAL_ONLY,
            processor
        );
        await processor.fireBatchOperations();

        expect(financialTransactions).toHaveLength(1);
        expect(financialTransactions[0]!.getAmount()?.toString()).toBe('8');
        expect(await movement(financialTransactions[0]!)).toEqual({
            from: 'ACME Realized',
            to: 'ACME Unrealized',
        });
        expect(baseTransactions).toHaveLength(1);
        expect(baseTransactions[0]!.getAmount()?.toString()).toBe('12');
        expect(await movement(baseTransactions[0]!)).toEqual({
            from: 'ACME Realized EXC',
            to: 'ACME Unrealized EXC',
        });
        for (const transaction of [...financialTransactions, ...baseTransactions]) {
            expect(transaction.isChecked()).toBe(true);
            expect(transaction.getAmount()?.gt(0)).toBe(true);
            expect((await transaction.getCreditAccount())?.getName()).toBeDefined();
            expect((await transaction.getDebitAccount())?.getName()).toBeDefined();
        }
    });

    test('associates an unmatched historical short sale with a complete split sale movement', async () => {
        const { stockBook, financialBook, baseBook } = createBooks();
        const { buy, sell, instrument, stockAccount } = createAccounts(stockBook);
        const sale = createOrder(
            stockBook,
            'sale',
            '2025-01-01',
            '3',
            instrument,
            sell,
            saleProperties('10', '11')
        );
        const purchase = createOrder(
            stockBook,
            'purchase',
            '2025-02-01',
            '1',
            buy,
            instrument,
            purchaseProperties('12', '13')
        );
        const service = new CalculateRealizedResultsService();
        const calls = stubSupport(service, financialBook, baseBook);
        const batches = capturePortfolioBatches(stockBook);
        const processor = new CalculateRealizedResultsProcessor(stockBook, financialBook, baseBook);

        await service['processSale'](
            baseBook,
            financialBook,
            'EUR',
            stockBook,
            stockAccount,
            sale,
            [purchase],
            new Summary(),
            true,
            CalculationModel.HISTORICAL_ONLY,
            processor
        );
        await processor.fireBatchOperations();

        expect(purchase.getProperty('gain_amount')).toBe('-2');
        expect(sale.isChecked()).toBe(false);
        expect(sale.getAmount()?.toString()).toBe('2');
        expect(batches.created).toHaveLength(1);
        const splitSale = batches.created[0]!;
        expect(splitSale.isChecked()).toBe(true);
        expect(splitSale.getAmount()?.toString()).toBe('1');
        expect(splitSale.getProperty('parent_id')).toBe('sale');
        expect(await movement(splitSale)).toEqual({ from: 'ACME', to: 'Sell' });
        expect(JSON.parse(splitSale.getProperty('liquidation_log')!)).toEqual([
            { id: 'purchase', dt: '2025-02-01', qt: '1', pr: '12', rt: '2' },
        ]);
        expect(calls.order).toEqual([
            'realized:standard:purchase:-2',
            'fx:standard:purchase:-4',
            'mtm:standard:purchase:12',
            'realized:standard:split:0',
            'fx:standard:split:0',
        ]);
    });

    test('preserves historical and fair branches for partially matched short purchases', async () => {
        const cases = [
            {
                model: CalculationModel.HISTORICAL_ONLY,
                expectedGain: '-2',
                expectedFxInput: '-4',
            },
            {
                model: CalculationModel.FAIR_ONLY,
                expectedGain: '-3',
                expectedFxInput: '-9',
            },
        ];

        for (const testCase of cases) {
            const { stockBook, financialBook, baseBook } = createBooks();
            const { buy, sell, instrument, stockAccount } = createAccounts(stockBook);
            const sale = createOrder(
                stockBook,
                'sale',
                '2025-01-01',
                '1',
                instrument,
                sell,
                saleProperties('10', '11')
            );
            const purchase = createOrder(
                stockBook,
                'purchase',
                '2025-02-01',
                '3',
                buy,
                instrument,
                purchaseProperties('12', '14')
            );
            const service = new CalculateRealizedResultsService();
            const calls = stubSupport(service, financialBook, baseBook);
            const batches = capturePortfolioBatches(stockBook);
            const processor = new CalculateRealizedResultsProcessor(
                stockBook,
                financialBook,
                baseBook
            );

            await service['processSale'](
                baseBook,
                financialBook,
                'EUR',
                stockBook,
                stockAccount,
                sale,
                [purchase],
                new Summary(),
                false,
                testCase.model,
                processor
            );
            await processor.fireBatchOperations();

            expect(purchase.isChecked()).toBe(false);
            expect(purchase.getAmount()?.toString()).toBe('2');
            expect(batches.created).toHaveLength(1);
            const splitPurchase = batches.created[0]!;
            expect(splitPurchase.isChecked()).toBe(true);
            expect(splitPurchase.getAmount()?.toString()).toBe('1');
            expect(splitPurchase.getProperty('gain_amount')).toBe(testCase.expectedGain);
            expect(splitPurchase.getProperty('short_sale')).toBe('true');
            expect(await movement(splitPurchase)).toEqual({ from: 'Buy', to: 'ACME' });
            expect(calls.realized.map(call => call.gain)).toEqual([testCase.expectedGain, '0']);
            expect(calls.fx.map(call => call.gain)).toEqual([testCase.expectedFxInput, '0']);
            expect(calls.mtm).toHaveLength(0);
        }
    });
});
