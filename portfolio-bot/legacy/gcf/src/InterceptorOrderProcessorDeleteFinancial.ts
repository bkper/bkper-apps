import { Book } from "bkper-js";
import { Result } from "./index.js";
import { FEES_PROP, INSTRUMENT_PROP, INTEREST_PROP, STOCK_BOT_AGENT_ID, STOCK_GAIN_HASHTAG, STOCK_LOSS_HASHTAG, EXCHANGE_GAIN_HASHTAG, EXCHANGE_LOSS_HASHTAG, FX_PREFIX } from "./constants.js";
import { InterceptorOrderProcessorDelete } from "./InterceptorOrderProcessorDelete.js";

export class InterceptorOrderProcessorDeleteFinancial extends InterceptorOrderProcessorDelete {

    async intercept(financialBook: Book, event: bkper.Event): Promise<Result> {

        let operation = event.data.object as bkper.TransactionOperation;
        let transactionPayload = operation.transaction;

        if (!transactionPayload.posted) {
            return {result: false};
        }

        let responses: string[] = [];

        let response1 = await this.deleteTransaction(financialBook, `${FEES_PROP}_${transactionPayload.id}`);
        if (response1) {
            responses.push(await this.buildDeleteResponse(response1));
        }
        let response2 = await this.deleteTransaction(financialBook, `${INTEREST_PROP}_${transactionPayload.id}`);
        if (response2) {
            responses.push(await this.buildDeleteResponse(response2));
        }
        let response3 = await this.deleteTransaction(financialBook, `${INSTRUMENT_PROP}_${transactionPayload.id}`);
        if (response3) {
            await this.deleteOnStockBook(financialBook, response3.getId());
        } else {
            await this.deleteOnStockBook(financialBook, transactionPayload.id);
        }

        if (this.isTransactionStockGainOrLoss(transactionPayload) || this.isTransactionExchangeGainOrLoss(transactionPayload)) {
            const stockBook = this.botService.getStockBook(financialBook);
            if (stockBook && transactionPayload.remoteIds) {
                for (const remoteId of transactionPayload.remoteIds) {
                    let stockBookTransaction = await stockBook.getTransaction(remoteId.replace(FX_PREFIX, ''));
                    if (stockBookTransaction) {
                        await this.botService.flagStockAccountForRebuildIfNeeded(stockBookTransaction);
                        break;
                    }
                }
            }
        }

        return {result: responses.length > 0 ? responses : false};
    }

    private isTransactionStockGainOrLoss(transaction: bkper.Transaction): boolean {
        return transaction.agentId == STOCK_BOT_AGENT_ID && (transaction.description == STOCK_GAIN_HASHTAG || transaction.description == STOCK_LOSS_HASHTAG) ? true : false;
    }

    private isTransactionExchangeGainOrLoss(transaction: bkper.Transaction): boolean {
        return transaction.agentId == STOCK_BOT_AGENT_ID && (transaction.description == EXCHANGE_GAIN_HASHTAG || transaction.description == EXCHANGE_LOSS_HASHTAG) ? true : false;
    }

}
