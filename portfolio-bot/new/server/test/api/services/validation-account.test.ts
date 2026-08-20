import { describe, expect, test } from 'bun:test';
import { AccountType, Book, Transaction } from 'bkper-js';
import { ValidationAccount } from '../../../src/api/services/validation-account.js';

async function createAccount(type = AccountType.ASSET, properties: Record<string, string> = {}) {
    const book = new Book({
        id: 'portfolio-book',
        groups: [{ id: 'eur-group', properties: { stock_exc_code: 'EUR' } }],
        accounts: [
            {
                id: 'instrument-account',
                name: 'Instrument',
                type,
                properties,
                groups: [{ id: 'eur-group' }],
            },
        ],
    });
    const [account] = await book.getAccounts();
    if (!account) {
        throw new Error('Expected Account fixture');
    }
    return account;
}

function createTransaction(properties: Record<string, string> = {}): Transaction {
    return new Transaction(new Book({ id: 'portfolio-book' }), { properties });
}

describe('legacy menu ValidationAccount', () => {
    test('treats any present needs_rebuild property as requiring calculation', async () => {
        const validationAccount = new ValidationAccount(
            await createAccount(AccountType.ASSET, { needs_rebuild: 'FALSE' })
        );

        expect(validationAccount.needsRebuild()).toBe(true);
    });

    test('requires both an unchecked purchase and an unchecked sale', async () => {
        const validationAccount = new ValidationAccount(await createAccount());

        validationAccount.pushUncheckedPurchase(createTransaction());
        expect(validationAccount.hasUncalculatedResults()).toBe(false);

        validationAccount.pushUncheckedSale(createTransaction());
        expect(validationAccount.hasUncalculatedResults()).toBe(true);
    });

    test('preserves the missing exchange-rate rules', async () => {
        const missingPurchaseRate = new ValidationAccount(await createAccount());
        missingPurchaseRate.pushUncheckedPurchase(createTransaction());

        const forwardedPurchaseRate = new ValidationAccount(await createAccount());
        forwardedPurchaseRate.pushUncheckedPurchase(
            createTransaction({ fwd_purchase_exc_rate: '1.25' })
        );

        const missingSaleRate = new ValidationAccount(await createAccount());
        missingSaleRate.pushUncheckedSale(createTransaction());

        const currentSaleRate = new ValidationAccount(await createAccount());
        currentSaleRate.pushUncheckedSale(createTransaction({ sale_exc_rate: '1.30' }));

        const forwardedSaleRate = new ValidationAccount(await createAccount());
        forwardedSaleRate.pushUncheckedSale(createTransaction({ fwd_sale_exc_rate: '1.35' }));

        expect(await missingPurchaseRate.hasTransactionsMissingExcRates('USD')).toBe(true);
        expect(await forwardedPurchaseRate.hasTransactionsMissingExcRates('USD')).toBe(false);
        expect(await missingSaleRate.hasTransactionsMissingExcRates('USD')).toBe(true);
        expect(await currentSaleRate.hasTransactionsMissingExcRates('USD')).toBe(false);
        expect(await forwardedSaleRate.hasTransactionsMissingExcRates('USD')).toBe(false);
        expect(await missingSaleRate.hasTransactionsMissingExcRates('EUR')).toBe(false);
    });
});
