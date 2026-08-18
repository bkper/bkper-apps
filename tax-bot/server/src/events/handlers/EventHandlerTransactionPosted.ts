import { Amount, type Book, Transaction } from 'bkper-js';
import {
    ACCOUNT_CONTRA_NAME_DESTINATION_EXP,
    ACCOUNT_CONTRA_NAME_EXP,
    ACCOUNT_CONTRA_NAME_ORIGIN_EXP,
    ACCOUNT_NAME_DESTINATION_EXP,
    ACCOUNT_NAME_EXP,
    ACCOUNT_NAME_ORIGIN_EXP,
    EXC_AMOUNT_PROP,
    EXC_CODE_PROP,
    EXC_DATE_PROP,
    EXC_RATE_PROP,
    TAX_DESCRIPTION_PROP,
    TAX_EXCLUDED_AMOUNT_PROP,
    TAX_EXCLUDED_LEGACY_PROP,
    TAX_EXCLUDED_RATE_PROP,
    TAX_INCLUDED_AMOUNT_PROP,
    TAX_INCLUDED_LEGACY_PROP,
    TAX_INCLUDED_RATE_PROP,
    TAX_RATE_LEGACY_PROP,
    TAX_ROUND_PROP,
    TRANSACTION_DESCRIPTION_EXP,
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

        const fullNonIncludedTax = await this.getFullTaxRate_(
            book,
            originAccount,
            destinationAccount,
            false
        );

        let netAmount = new Amount(transaction.amount!);

        const fullIncludedAmount = await this.getFullTaxAmount_(
            book,
            originAccount,
            destinationAccount,
            true,
            transaction
        );
        const fullNonIncludedAmount = await this.getFullTaxAmount_(
            book,
            originAccount,
            destinationAccount,
            false,
            transaction
        );

        const fullIncludedTax = await this.getFullTaxRate_(
            book,
            originAccount,
            destinationAccount,
            true
        );

        if (
            fullIncludedTax.eq(0) &&
            fullNonIncludedTax.eq(0) &&
            fullIncludedAmount.eq(0) &&
            fullNonIncludedAmount.eq(0)
        ) {
            return false;
        }

        if (fullIncludedTax.gte(100)) {
            return `Cannot process more than 100% in total taxes. Sum of all taxes: ${fullIncludedTax}`;
        }

        if (fullIncludedTax.gt(0) && fullIncludedAmount.eq(0)) {
            const includedTaxAmount = fullIncludedTax
                .times(transaction.amount!)
                .div(fullIncludedTax.plus(100));
            netAmount = new Amount(transaction.amount!).minus(includedTaxAmount);
        } else if (fullIncludedAmount.gt(0)) {
            netAmount = new Amount(transaction.amount!).minus(fullIncludedAmount);
        }

        let transactions: Transaction[] = [];

        transactions = transactions.concat(
            this.getTaxTransactions(book, originAccount, destinationAccount, transaction, netAmount)
        );
        transactions = transactions.concat(
            this.getTaxTransactions(book, destinationAccount, originAccount, transaction, netAmount)
        );

        if (transactions.length > 0) {
            transactions = await book.batchCreateTransactions(transactions);
            if (transactions.length > 0) {
                return transactions.map(
                    transaction =>
                        `POSTED: ${transaction.getDateFormatted()} ${book.formatValue(transaction.getAmount())} ${transaction.getDescription()}`
                );
            } else {
                return false;
            }
        } else {
            return false;
        }
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

    protected async getFullTaxAmount_(
        book: Book,
        creditAccount: bkper.Account,
        debitAccount: bkper.Account,
        included: boolean,
        transaction: bkper.Transaction
    ): Promise<Amount> {
        let totalAmount = new Amount('0');
        totalAmount = totalAmount.plus(
            this.getFullTaxAmountFromAccount_(book, creditAccount, included, transaction)
        );
        totalAmount = totalAmount.plus(
            this.getFullTaxAmountFromAccount_(book, debitAccount, included, transaction)
        );
        return totalAmount;
    }

    protected getFullTaxAmountFromAccount_(
        book: Book,
        account: bkper.Account,
        included: boolean,
        transaction: bkper.Transaction
    ): Amount {
        let totalAmount = this.getTaxAmountFromAccountOrGroup_(
            book,
            account,
            included,
            transaction
        );
        const groups = account.groups;
        if (groups != null) {
            for (const group of groups) {
                totalAmount = totalAmount.plus(
                    this.getTaxAmountFromAccountOrGroup_(book, group, included, transaction)
                );
            }
        }
        return totalAmount;
    }

    protected getTaxAmountFromAccountOrGroup_(
        book: Book,
        accountOrGroup: bkper.Account | bkper.Group,
        included: boolean,
        transaction: bkper.Transaction
    ): Amount {
        const includedAmount = transaction.properties![TAX_INCLUDED_AMOUNT_PROP];
        const excludedAmount = transaction.properties![TAX_EXCLUDED_AMOUNT_PROP];
        let amount: Amount | null | undefined = null;

        if (
            accountOrGroup.properties![TAX_RATE_LEGACY_PROP] ||
            accountOrGroup.properties![TAX_INCLUDED_RATE_PROP] ||
            accountOrGroup.properties![TAX_INCLUDED_LEGACY_PROP]
        ) {
            if (included && includedAmount) {
                amount = book.parseValue(includedAmount);
            }
        }

        if (
            accountOrGroup.properties![TAX_EXCLUDED_RATE_PROP] ||
            accountOrGroup.properties![TAX_EXCLUDED_LEGACY_PROP]
        ) {
            if (!included && excludedAmount) {
                amount = book.parseValue(excludedAmount);
            }
        }

        if (!amount) {
            amount = new Amount('0');
        }
        amount = amount.abs();
        return amount;
    }

    protected getTaxTransactions(
        book: Book,
        account: bkper.Account,
        contraAccount: bkper.Account,
        transaction: bkper.Transaction,
        netAmount: Amount
    ): Transaction[] {
        const transactions: Transaction[] = [];
        this.addTaxTransactions(
            book,
            account,
            account,
            contraAccount,
            transaction,
            netAmount,
            transactions
        );

        const groups = account.groups;
        if (groups != null) {
            for (const group of groups) {
                this.addTaxTransactions(
                    book,
                    group,
                    account,
                    contraAccount,
                    transaction,
                    netAmount,
                    transactions
                );
            }
        }

        return transactions;
    }

    protected addTaxTransactions(
        book: Book,
        accountOrGroup: bkper.Account | bkper.Group,
        account: bkper.Account,
        contraAccount: bkper.Account,
        transaction: bkper.Transaction,
        netAmount: Amount,
        transactions: Transaction[]
    ): void {
        const taxTags = [
            TAX_RATE_LEGACY_PROP,
            TAX_INCLUDED_RATE_PROP,
            TAX_INCLUDED_LEGACY_PROP,
            TAX_EXCLUDED_RATE_PROP,
            TAX_EXCLUDED_LEGACY_PROP,
        ];
        for (const taxTag of taxTags) {
            const taxTransaction = this.createTaxTransaction(
                book,
                accountOrGroup,
                account.name!,
                contraAccount.name!,
                transaction,
                taxTag,
                netAmount
            );
            if (taxTransaction != null) {
                transactions.push(taxTransaction);
            }
        }
    }

    protected createTaxTransaction(
        book: Book,
        accountOrGroup: bkper.Account | bkper.Group,
        accountName: string,
        contraAccountName: string,
        transaction: bkper.Transaction,
        taxProperty: string,
        netAmount: Amount
    ): Transaction | null {
        const taxPropertyValue = accountOrGroup.properties![taxProperty];

        if (taxPropertyValue == null || taxPropertyValue.trim() == '') {
            return null;
        }

        const tax = book.parseValue(taxPropertyValue);

        const includedAmount = book.parseValue(transaction.properties![TAX_INCLUDED_AMOUNT_PROP]!);
        const excludedAmount = book.parseValue(transaction.properties![TAX_EXCLUDED_AMOUNT_PROP]!);
        let taxAmount: Amount | null | undefined = null;

        if (
            taxProperty == TAX_INCLUDED_RATE_PROP ||
            taxProperty == TAX_INCLUDED_LEGACY_PROP ||
            (taxProperty == TAX_RATE_LEGACY_PROP && tax!.gt(0))
        ) {
            taxAmount = includedAmount;
        } else if (
            taxProperty == TAX_EXCLUDED_RATE_PROP ||
            taxProperty == TAX_EXCLUDED_LEGACY_PROP
        ) {
            taxAmount = excludedAmount;
        }

        if ((tax == null || tax.eq(0)) && (taxAmount == null || taxAmount.eq(0))) {
            return null;
        }

        let amount: Amount = taxAmount ? taxAmount : netAmount.times(tax!.div(100));

        amount = amount.abs();

        if (amount.eq(0)) {
            return null;
        }

        let taxDescription = accountOrGroup.properties![TAX_DESCRIPTION_PROP];

        if (taxDescription == null) {
            taxDescription = '';
        }

        const taxRound = +transaction.properties![TAX_ROUND_PROP]!;
        if (taxRound != null && !isNaN(taxRound) && taxRound <= 8) {
            amount = amount.round(taxRound);
        } else {
            amount = amount.round(book.getFractionDigits());
        }

        taxDescription = taxDescription.replace(
            TRANSACTION_DESCRIPTION_EXP,
            transaction.description!
        );
        taxDescription = taxDescription.replace(ACCOUNT_NAME_EXP, accountName);
        taxDescription = taxDescription.replace(ACCOUNT_CONTRA_NAME_EXP, contraAccountName);

        if (accountName == transaction.creditAccount!.name) {
            taxDescription = taxDescription.replace(ACCOUNT_NAME_ORIGIN_EXP, accountName);
            taxDescription = taxDescription.replace(ACCOUNT_NAME_DESTINATION_EXP, '');
        }
        if (accountName == transaction.debitAccount!.name) {
            taxDescription = taxDescription.replace(ACCOUNT_NAME_ORIGIN_EXP, '');
            taxDescription = taxDescription.replace(ACCOUNT_NAME_DESTINATION_EXP, accountName);
        }

        if (contraAccountName == transaction.creditAccount!.name) {
            taxDescription = taxDescription.replace(
                ACCOUNT_CONTRA_NAME_ORIGIN_EXP,
                contraAccountName
            );
            taxDescription = taxDescription.replace(ACCOUNT_CONTRA_NAME_DESTINATION_EXP, '');
        }
        if (contraAccountName == transaction.debitAccount!.name) {
            taxDescription = taxDescription.replace(ACCOUNT_CONTRA_NAME_ORIGIN_EXP, '');
            taxDescription = taxDescription.replace(
                ACCOUNT_CONTRA_NAME_DESTINATION_EXP,
                contraAccountName
            );
        }

        const taxTag = taxProperty == TAX_RATE_LEGACY_PROP ? 'tax' : taxProperty;

        const id = `${super.getId(taxTag, transaction, accountOrGroup)}`;

        const taxTransaction = new Transaction(book)
            .addRemoteId(id)
            .setDate(transaction.date!)
            .setAmount(amount)
            .setDescription(taxDescription)
            .setProperty(EXC_CODE_PROP, transaction.properties![EXC_CODE_PROP])
            .setProperty(EXC_DATE_PROP, transaction.properties![EXC_DATE_PROP]);

        const transactionExchangeRate = transaction.properties![EXC_RATE_PROP];
        const transactionExchangeAmount = transaction.properties![EXC_AMOUNT_PROP];

        if (transactionExchangeRate) {
            taxTransaction.setProperty(EXC_RATE_PROP, transactionExchangeRate);
        }
        if (transactionExchangeAmount) {
            const exchangeAmount = book.parseValue(transactionExchangeAmount);
            const rate = exchangeAmount!.div(transaction.amount!);
            taxTransaction.setProperty(EXC_RATE_PROP, rate.toString());
        }

        if (transactionExchangeAmount) {
            const exchangeAmount = book.parseValue(transactionExchangeAmount);
            if (exchangeAmount!.round(8).eq(0)) {
                taxTransaction.setProperty(EXC_AMOUNT_PROP, '0');
                taxTransaction.deleteProperty(EXC_RATE_PROP);
            }
        }

        for (const [key, value] of Object.entries(transaction.properties!)) {
            if (
                key != EXC_RATE_PROP &&
                key != EXC_AMOUNT_PROP &&
                key != EXC_CODE_PROP &&
                key != EXC_DATE_PROP &&
                key != TAX_ROUND_PROP &&
                key != TAX_INCLUDED_AMOUNT_PROP &&
                key != TAX_EXCLUDED_AMOUNT_PROP
            ) {
                taxTransaction.setVisibleProperty(key, value);
            }
        }

        console.log('taxTransaction properties', taxTransaction.getProperties());

        return taxTransaction;
    }
}
