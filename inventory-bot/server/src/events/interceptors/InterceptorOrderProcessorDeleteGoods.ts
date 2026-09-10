import { AccountType, Amount, type Account, type Book, type Transaction } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import { NEEDS_REBUILD_PROP, ORIGINAL_QUANTITY_PROP } from '../../shared/constants.js';
import { optionalLookup } from '../../shared/optional-lookup.js';
import type { EventResult } from '../types.js';
import { InterceptorOrderProcessorDelete } from './InterceptorOrderProcessorDelete.js';

export class InterceptorOrderProcessorDeleteGoods extends InterceptorOrderProcessorDelete {
    constructor(context: AppContext) {
        super(context);
    }

    async intercept(inventoryBook: Book, event: bkper.Event): Promise<EventResult> {
        const operation = event.data?.object as bkper.TransactionOperation;
        const transactionPayload = operation.transaction;

        if (transactionPayload && !transactionPayload.posted) {
            return { result: false };
        }

        const goodAccount = transactionPayload
            ? await this.getGoodAccount(inventoryBook, transactionPayload)
            : undefined;
        if (!goodAccount) {
            return { result: false };
        }

        let responses: Transaction[] | undefined;

        // Deleted Transaction is the root purchase Transaction.
        if (transactionPayload!.properties?.[ORIGINAL_QUANTITY_PROP]) {
            let results: string[] = [];

            const originalQuantity = new Amount(
                transactionPayload!.properties[ORIGINAL_QUANTITY_PROP]
            ).toNumber();
            const amount = new Amount(transactionPayload!.amount ?? 0).toNumber();
            if (originalQuantity != amount) {
                await goodAccount.setProperty(NEEDS_REBUILD_PROP, 'TRUE').update();
                const warningMessage = `Flagging account ${goodAccount.getName()} for rebuild`;
                results.push(warningMessage);

                responses = await this.cascadeDeleteInventoryTransactions(
                    inventoryBook,
                    transactionPayload!
                );
                if (responses) {
                    results = results.concat(await this.buildDeleteResults(responses));
                }

                return { result: results };
            }

            return { result: false };
        }

        const goodExchangeCode = await this.botService.getExchangeCodeFromAccount(goodAccount);
        const financialBook = await this.botService.getFinancialBook(
            inventoryBook,
            goodExchangeCode
        );

        // Deleted Transaction is the sale Transaction: delete COGS in the Financial Book.
        responses =
            financialBook && transactionPayload
                ? await this.cascadeDeleteFinancialTransactions(financialBook, transactionPayload)
                : undefined;
        if (responses) {
            return { result: await this.buildDeleteResults(responses, financialBook) };
        }

        return { result: false };
    }

    private async getGoodAccount(
        inventoryBook: Book,
        transactionPayload: bkper.Transaction
    ): Promise<Account | undefined> {
        if (transactionPayload.debitAccount?.type == AccountType.INCOMING) {
            return optionalLookup(() =>
                inventoryBook.getAccount(transactionPayload.creditAccount?.id)
            );
        }
        if (transactionPayload.creditAccount?.type == AccountType.OUTGOING) {
            return optionalLookup(() =>
                inventoryBook.getAccount(transactionPayload.debitAccount?.id)
            );
        }
        return undefined;
    }
}
