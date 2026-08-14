import { Amount, type Book } from 'bkper-js';
import {
    TAX_EXCLUDED_LEGACY_PROP,
    TAX_EXCLUDED_RATE_PROP,
    TAX_INCLUDED_LEGACY_PROP,
    TAX_INCLUDED_RATE_PROP,
    TAX_RATE_LEGACY_PROP,
} from '../../constants.js';
import type { EventResultValue } from '../types.js';
import EventHandler from './EventHandler.js';

export default class EventHandlerTransactionPosted extends EventHandler {
    protected async processTransaction(
        book: Book,
        transaction: bkper.Transaction
    ): Promise<EventResultValue> {
        if (transaction.agentId === 'sales-tax-bot') {
            console.log('Same payload agent. Preventing bot loop.');
            return false;
        }

        const originAccount = transaction.creditAccount!;
        const destinationAccount = transaction.debitAccount!;

        await this.getFullTaxRate_(book, originAccount, destinationAccount, false);
        await this.getFullTaxRate_(book, originAccount, destinationAccount, true);

        return false;
    }

    protected async getFullTaxRate_(
        book: Book,
        creditAccount: bkper.Account,
        debitAccount: bkper.Account,
        included: boolean
    ): Promise<Amount> {
        let totalTax = new Amount('0');
        totalTax = totalTax.plus(this.getFullTaxRateFromAccount_(book, creditAccount, included));
        totalTax = totalTax.plus(this.getFullTaxRateFromAccount_(book, debitAccount, included));
        return totalTax;
    }

    protected getFullTaxRateFromAccount_(
        book: Book,
        account: bkper.Account,
        included: boolean
    ): Amount {
        let totalTax = this.getTaxRateFromAccountOrGroup_(book, account, included);
        const groups = account.groups;
        if (groups != null) {
            for (const group of groups) {
                totalTax = totalTax.plus(this.getTaxRateFromAccountOrGroup_(book, group, included));
            }
        }
        return totalTax;
    }

    protected getTaxRateFromAccountOrGroup_(
        book: Book,
        accountOrGroup: bkper.Account | bkper.Group,
        included: boolean
    ): Amount {
        const properties = accountOrGroup.properties!;
        const legacyTaxRate = properties[TAX_RATE_LEGACY_PROP];
        if (legacyTaxRate == null) {
            const taxIncluded =
                properties[TAX_INCLUDED_RATE_PROP] || properties[TAX_INCLUDED_LEGACY_PROP];
            const taxExcluded =
                properties[TAX_EXCLUDED_RATE_PROP] || properties[TAX_EXCLUDED_LEGACY_PROP];

            let tax: Amount | undefined;
            if (included && taxIncluded) {
                tax = book.parseValue(taxIncluded);
            } else if (!included && taxExcluded) {
                tax = book.parseValue(taxExcluded);
            }
            if (!tax) {
                tax = new Amount('0');
            }
            return tax;
        }

        const tax = book.parseValue(legacyTaxRate);

        if (!tax) {
            return new Amount('0');
        }

        if (included && tax.lt(0)) {
            return new Amount('0');
        }

        if (!included && tax.gt(0)) {
            return new Amount('0');
        }

        return tax;
    }
}
