import { Account, type Book, Transaction } from 'bkper-js';
import type { AppContext } from '../../app-context.js';
import { CHILD_FROM_PROP, CHILD_TO_PROP } from '../../constants.js';
import { EventHandlerTransaction } from './EventHandlerTransaction.js';

export class EventHandlerTransactionUpdated extends EventHandlerTransaction {
    constructor(context: AppContext) {
        super(context);
    }

    protected getTransactionQuery(transaction: bkper.Transaction): string {
        return `remoteId:${transaction.id}`;
    }

    protected parentTransactionNotFound(
        childBook: Book,
        parentBook: Book,
        childTransaction: bkper.Transaction
    ): Promise<string | null> {
        return Promise.resolve(null);
    }

    protected async parentTransactionFound(
        childBook: Book,
        parentBook: Book,
        childTransaction: bkper.Transaction,
        parentTransaction: Transaction
    ): Promise<string | null> {
        const childCreditAccount = (await childBook.getAccount(
            childTransaction.creditAccount!.id
        ))!;
        const childDebitAccount = (await childBook.getAccount(childTransaction.debitAccount!.id))!;
        const parentBookAnchor = super.buildBookAnchor(parentBook);

        const parentCreditAccount = await this.getParentAccount(
            childBook,
            parentBook,
            childCreditAccount
        );
        const parentDebitAccount = await this.getParentAccount(
            childBook,
            parentBook,
            childDebitAccount
        );

        if (parentCreditAccount == null || parentDebitAccount == null) {
            return null;
        }

        await this.updateParentTransaction(
            childBook,
            parentBook,
            childTransaction,
            parentTransaction,
            parentCreditAccount,
            parentDebitAccount
        );

        const amountFormatted = parentBook.formatValue(parentTransaction.getAmount());
        const record = `EDITED: ${parentTransaction.getDateFormatted()} ${amountFormatted} ${await parentTransaction.getCreditAccountName()} ${await parentTransaction.getDebitAccountName()} ${parentTransaction.getDescription()}`;
        return `${parentBookAnchor}: ${record}`;
    }

    private async updateParentTransaction(
        childBook: Book,
        parentBook: Book,
        childTransaction: bkper.Transaction,
        parentTransaction: Transaction,
        parentCreditAccount: Account,
        parentDebitAccount: Account
    ): Promise<void> {
        const childCreditAccount = (await childBook.getAccount(
            childTransaction.creditAccount!.id
        ))!;
        const childDebitAccount = (await childBook.getAccount(childTransaction.debitAccount!.id))!;

        if (parentTransaction.isChecked()) {
            await parentTransaction.uncheck();
        }

        const amount = this.getAmount(parentBook, childTransaction);
        if (amount) {
            parentTransaction
                .setDate(childTransaction.date!)
                .setVisibleProperties(childTransaction.properties!)
                .setProperty(CHILD_FROM_PROP, childCreditAccount.getName())
                .setProperty(CHILD_TO_PROP, childDebitAccount.getName())
                .setAmount(amount)
                .setCreditAccount(parentCreditAccount)
                .setDebitAccount(parentDebitAccount)
                .setDescription(childTransaction.description!)
                .addRemoteId(childTransaction.id!);

            let urls = childTransaction.urls;
            if (!urls) {
                urls = [];
            }

            if (childTransaction.urls) {
                urls = childTransaction.urls;
            }

            if (childTransaction.files) {
                childTransaction.files.forEach(file => {
                    urls.push(file.url!);
                });
            }

            parentTransaction.setUrls(urls);
            await parentTransaction.update();
        }
    }
}
