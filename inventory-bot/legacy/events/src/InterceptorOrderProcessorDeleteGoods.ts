import { Account, AccountType, Book, Transaction, Amount } from "bkper-js";
import { Result } from "./index.js";
import { InterceptorOrderProcessorDelete } from "./InterceptorOrderProcessorDelete.js";
import { NEEDS_REBUILD_PROP, ORIGINAL_QUANTITY_PROP } from "./constants.js";
import { AppContext } from "./AppContext.js";

export class InterceptorOrderProcessorDeleteGoods extends InterceptorOrderProcessorDelete {

    constructor(context: AppContext) {
        super(context);
    }

    async intercept(inventoryBook: Book, event: bkper.Event): Promise<Result> {

        const operation = event.data?.object as bkper.TransactionOperation;
        const transactionPayload = operation.transaction;

        if (transactionPayload && !transactionPayload.posted) {
            return { result: false };
        }

        const goodAccount = transactionPayload ? await this.getGoodAccount(inventoryBook, transactionPayload) : undefined;
        if (!goodAccount) {
            return { result: false };
        }

        let responses: Transaction[] | undefined;

        // deleted transaction is the root purchase transaction
        if (transactionPayload!.properties?.[ORIGINAL_QUANTITY_PROP]) {
            let results: string[] = [];

            const originalQuantity = new Amount(transactionPayload!.properties[ORIGINAL_QUANTITY_PROP]).toNumber();
            const amount = new Amount(transactionPayload!.amount ?? 0).toNumber();
            if (originalQuantity != amount) {
                // transaction had been already processed by FIFO: delete splitted transactions in inventory book and flag account for rebuild
                await goodAccount.setProperty(NEEDS_REBUILD_PROP, 'TRUE').update();
                const warningMsg = `Flagging account ${goodAccount.getName()} for rebuild`;
                results.push(warningMsg);

                responses = await this.cascadeDeleteInventoryTransactions(inventoryBook, transactionPayload!);
                if (responses) {
                    results = results.concat(await this.buildDeleteResults(responses));
                }

                return { result: results };
            }

            return { result: false };
        }

        const goodExcCode = await this.botService.getExchangeCodeFromAccount(goodAccount);
        const financialBook = await this.botService.getFinancialBook(inventoryBook, goodExcCode);

        // deleted transaction is the sale transaction: delete COGS transaction in financial book
        responses = financialBook && transactionPayload ? await this.cascadeDeleteFinancialTransactions(financialBook, transactionPayload) : undefined;
        if (responses) {
            return { result: await this.buildDeleteResults(responses, financialBook) };
        }

        return { result: false };
    }

    private async getGoodAccount(inventoryBook: Book, transactionPayload: bkper.Transaction): Promise<Account | undefined> {
        if (transactionPayload.debitAccount?.type == AccountType.INCOMING) {
            return await inventoryBook.getAccount(transactionPayload.creditAccount?.id);
        }
        if (transactionPayload.creditAccount?.type == AccountType.OUTGOING) {
            return await inventoryBook.getAccount(transactionPayload.debitAccount?.id);
        }
        return undefined;
    }

}