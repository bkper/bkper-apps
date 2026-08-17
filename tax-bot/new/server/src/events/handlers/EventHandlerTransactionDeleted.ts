import type { Book } from 'bkper-js';
import {
    TAX_EXCLUDED_LEGACY_PROP,
    TAX_EXCLUDED_RATE_PROP,
    TAX_INCLUDED_LEGACY_PROP,
    TAX_INCLUDED_RATE_PROP,
    TAX_RATE_LEGACY_PROP,
} from '../../constants.js';
import type { EventResultValue } from '../types.js';
import EventHandler from './EventHandler.js';

export default class EventHandlerTransactionDeleted extends EventHandler {
    protected async processTransaction(
        book: Book,
        transaction: bkper.Transaction,
        event: bkper.Event
    ): Promise<EventResultValue> {
        const creditAccount = transaction.creditAccount!;
        const debitAccount = transaction.debitAccount!;

        let transactionIds: string[] = [];

        transactionIds = transactionIds.concat(
            await this.getTaxTransactionsIds(book, creditAccount, transaction)
        );
        transactionIds = transactionIds.concat(
            await this.getTaxTransactionsIds(book, debitAccount, transaction)
        );

        if (event.data!.previousAttributes) {
            const oldCreditAccountId = event.data!.previousAttributes['creditAccId'];
            if (oldCreditAccountId && oldCreditAccountId != transaction.creditAccount!.id) {
                const oldCreditAccount = await book.getAccount(oldCreditAccountId);
                transactionIds = transactionIds.concat(
                    await this.getTaxTransactionsIds(book, oldCreditAccount!.json(), transaction)
                );
            }

            const oldDebitAccountId = event.data!.previousAttributes['debitAccId'];
            if (oldDebitAccountId && oldDebitAccountId != transaction.debitAccount!.id) {
                const oldDebitAccount = await book.getAccount(oldDebitAccountId);
                transactionIds = transactionIds.concat(
                    await this.getTaxTransactionsIds(book, oldDebitAccount!.json(), transaction)
                );
            }
        }

        if (transactionIds.length == 0) {
            return false;
        }

        const deletedRecords: string[] = [];
        for (const id of transactionIds) {
            let linkedTransaction = (await book.listTransactions(`remoteId:${id}`)).getFirst();
            if (linkedTransaction) {
                if (linkedTransaction.isChecked()) {
                    linkedTransaction = await linkedTransaction.uncheck();
                }
                linkedTransaction = await linkedTransaction.trash();
                deletedRecords.push(
                    `DELETED: ${linkedTransaction.getDateFormatted()} ${book.formatValue(linkedTransaction.getAmount())} ${linkedTransaction.getDescription()}`
                );
            }
        }

        if (deletedRecords.length != 0) {
            return deletedRecords;
        } else {
            return false;
        }
    }

    protected async getTaxTransactionsIds(
        book: Book,
        account: bkper.Account,
        transaction: bkper.Transaction
    ): Promise<string[]> {
        const transactionIds: string[] = [];

        this.addTaxTransactions(book, account, transaction, transactionIds);

        const groups = account.groups;
        if (groups != null) {
            for (const group of groups) {
                this.addTaxTransactions(book, group, transaction, transactionIds);
            }
        }

        return transactionIds;
    }

    protected addTaxTransactions(
        book: Book,
        accountOrGroup: bkper.Account | bkper.Group,
        transaction: bkper.Transaction,
        transactionIds: string[]
    ): void {
        const taxTags = [
            TAX_RATE_LEGACY_PROP,
            TAX_INCLUDED_RATE_PROP,
            TAX_INCLUDED_LEGACY_PROP,
            TAX_EXCLUDED_RATE_PROP,
            TAX_EXCLUDED_LEGACY_PROP,
        ];
        for (const taxTag of taxTags) {
            const taxTransactionId = this.getTaxTransactionId(
                book,
                accountOrGroup,
                transaction,
                taxTag
            );
            if (taxTransactionId != null) {
                transactionIds.push(taxTransactionId);
            }
        }
    }

    protected getTaxTransactionId(
        _book: Book,
        accountOrGroup: bkper.Account | bkper.Group,
        transaction: bkper.Transaction,
        taxProperty: string
    ): string | null {
        if (!accountOrGroup.properties) {
            return null;
        }

        const taxPropertyValue = accountOrGroup.properties[taxProperty];

        if (taxPropertyValue == null || taxPropertyValue.trim() == '') {
            return null;
        }

        const taxTag = taxProperty == TAX_RATE_LEGACY_PROP ? 'tax' : taxProperty;

        return `${super.getId(taxTag, transaction, accountOrGroup)}`;
    }
}
