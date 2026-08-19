import type { Book } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import {
    EXCHANGE_GAIN_HASHTAG,
    EXCHANGE_LOSS_HASHTAG,
    FEES_PROP,
    FX_PREFIX,
    INSTRUMENT_PROP,
    INTEREST_PROP,
    STOCK_BOT_AGENT_ID,
    STOCK_GAIN_HASHTAG,
    STOCK_LOSS_HASHTAG,
} from '../../shared/constants.js';
import { optionalLookup } from '../../shared/optional-lookup.js';
import type { EventResult } from '../types.js';
import { InterceptorOrderProcessorDelete } from './InterceptorOrderProcessorDelete.js';

export class InterceptorOrderProcessorDeleteFinancial extends InterceptorOrderProcessorDelete {
    constructor(context: AppContext) {
        super(context);
    }

    async intercept(financialBook: Book, event: bkper.Event): Promise<EventResult> {
        const operation = event.data!.object as bkper.TransactionOperation;
        const transactionPayload = operation.transaction!;

        if (!transactionPayload.posted) {
            return { result: false };
        }

        const responses: string[] = [];

        const feesTransaction = await this.deleteTransaction(
            financialBook,
            `${FEES_PROP}_${transactionPayload.id}`
        );
        if (feesTransaction) {
            responses.push(await this.buildDeleteResponse(feesTransaction));
        }

        const interestTransaction = await this.deleteTransaction(
            financialBook,
            `${INTEREST_PROP}_${transactionPayload.id}`
        );
        if (interestTransaction) {
            responses.push(await this.buildDeleteResponse(interestTransaction));
        }

        const instrumentTransaction = await this.deleteTransaction(
            financialBook,
            `${INSTRUMENT_PROP}_${transactionPayload.id}`
        );
        if (instrumentTransaction) {
            await this.deleteOnStockBook(financialBook, instrumentTransaction.getId()!);
        } else {
            await this.deleteOnStockBook(financialBook, transactionPayload.id!);
        }

        if (
            this.isTransactionStockGainOrLoss(transactionPayload) ||
            this.isTransactionExchangeGainOrLoss(transactionPayload)
        ) {
            const stockBook = this.botService.getStockBook(financialBook);
            if (stockBook && transactionPayload.remoteIds) {
                for (const remoteId of transactionPayload.remoteIds) {
                    const stockBookTransaction = await optionalLookup(() =>
                        stockBook.getTransaction(remoteId.replace(FX_PREFIX, ''))
                    );
                    if (stockBookTransaction) {
                        await this.botService.flagStockAccountForRebuildIfNeeded(
                            stockBookTransaction
                        );
                        break;
                    }
                }
            }
        }

        return { result: responses.length > 0 ? responses : false };
    }

    private isTransactionStockGainOrLoss(transaction: bkper.Transaction): boolean {
        return (
            transaction.agentId == STOCK_BOT_AGENT_ID &&
            (transaction.description == STOCK_GAIN_HASHTAG ||
                transaction.description == STOCK_LOSS_HASHTAG)
        );
    }

    private isTransactionExchangeGainOrLoss(transaction: bkper.Transaction): boolean {
        return (
            transaction.agentId == STOCK_BOT_AGENT_ID &&
            (transaction.description == EXCHANGE_GAIN_HASHTAG ||
                transaction.description == EXCHANGE_LOSS_HASHTAG)
        );
    }
}
