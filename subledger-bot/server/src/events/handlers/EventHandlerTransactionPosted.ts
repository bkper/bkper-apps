import { type Book, Transaction } from 'bkper-js';
import type { AppContext } from '../../app-context.js';
import { CHILD_FROM_PROP, CHILD_TO_PROP } from '../../constants.js';
import { EventHandlerTransaction } from './EventHandlerTransaction.js';

export class EventHandlerTransactionPosted extends EventHandlerTransaction {
    constructor(context: AppContext) {
        super(context);
    }

    protected getTransactionQuery(transaction: bkper.Transaction): string {
        return `remoteId:${transaction.id}`;
    }

    protected async parentTransactionFound(
        childBook: Book,
        parentBook: Book,
        childTransaction: bkper.Transaction,
        parentTransaction: Transaction
    ): Promise<string | null> {
        if (!parentTransaction.isPosted() && (await this.isReadyToPost(parentTransaction))) {
            await parentTransaction.post();
            return await this.buildFoundResponse(parentBook, parentTransaction);
        }
        return null;
    }

    private async buildFoundResponse(
        childBook: Book,
        parentTransaction: Transaction
    ): Promise<string> {
        const bookAnchor = super.buildBookAnchor(childBook);
        const amountFormatted = childBook.formatValue(parentTransaction.getAmount());
        const record = `POSTED: ${parentTransaction.getDateFormatted()} ${amountFormatted} ${await parentTransaction.getCreditAccountName()} ${await parentTransaction.getDebitAccountName()} ${parentTransaction.getDescription()}`;
        return `${bookAnchor}: ${record}`;
    }

    protected async parentTransactionNotFound(
        childBook: Book,
        parentBook: Book,
        childTransaction: bkper.Transaction
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

        const amount = this.getAmount(parentBook, childTransaction);
        if (amount == null) {
            return null;
        }

        const parentTransaction = new Transaction(parentBook)
            .setDate(childTransaction.date!)
            .setVisibleProperties(childTransaction.properties!)
            .setProperty(CHILD_FROM_PROP, childCreditAccount.getName())
            .setProperty(CHILD_TO_PROP, childDebitAccount.getName())
            .setAmount(amount)
            .setCreditAccount(parentCreditAccount)
            .setDebitAccount(parentDebitAccount)
            .setDescription(childTransaction.description!)
            .addRemoteId(childTransaction.id!);

        const record = `${parentTransaction.getDate()} ${parentTransaction.getAmount()} ${parentCreditAccount ? parentCreditAccount.getName() : ''} ${parentDebitAccount ? parentDebitAccount.getName() : ''} ${parentTransaction.getDescription()}`;

        if (await this.isReadyToPost(parentTransaction)) {
            await parentTransaction.post();
        } else {
            parentTransaction.setDescription(
                `${parentTransaction.getCreditAccount() == null ? parentCreditAccount!.getName() : ''} ${parentTransaction.getDebitAccount() == null ? parentDebitAccount!.getName() : ''} ${parentTransaction.getDescription()}`.trim()
            );
            await parentTransaction.create();
        }

        return `${parentBookAnchor}: ${record}`;
    }
}
