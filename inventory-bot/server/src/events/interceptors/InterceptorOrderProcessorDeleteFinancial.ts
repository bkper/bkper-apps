import { AccountType, Amount, type Book, type Transaction } from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import {
    ADDITIONAL_COSTS_CREDITS_QUERY_RANGE,
    APP_ID,
    COGS_HASHTAG,
    GOOD_PROP,
    LEGACY_COGS_HASHTAG,
    NEEDS_REBUILD_PROP,
    ORIGINAL_QUANTITY_PROP,
    PURCHASE_CODE_PROP,
    PURCHASE_INVOICE_PROP,
    QUANTITY_PROP,
    QUANTITY_SOLD_PROP,
} from '../../shared/constants.js';
import { optionalLookup } from '../../shared/optional-lookup.js';
import type { EventResult } from '../types.js';
import { InterceptorOrderProcessorDelete } from './InterceptorOrderProcessorDelete.js';

function isBotGeneratedCOGSTransaction(transactionPayload: bkper.Transaction): boolean {
    if (transactionPayload.agentId != APP_ID) {
        return false;
    }

    if (!transactionPayload.remoteIds || transactionPayload.remoteIds.length == 0) {
        return false;
    }

    if (transactionPayload.properties?.[QUANTITY_SOLD_PROP] != undefined) {
        return true;
    }

    const description = transactionPayload.description ?? '';
    return description.includes(COGS_HASHTAG) || description.includes(LEGACY_COGS_HASHTAG);
}

export class InterceptorOrderProcessorDeleteFinancial extends InterceptorOrderProcessorDelete {
    constructor(context: AppContext) {
        super(context);
    }

    async intercept(financialBook: Book, event: bkper.Event): Promise<EventResult> {
        if (!event.data) {
            return { result: false };
        }
        const operation = event.data.object as bkper.TransactionOperation;
        const transactionPayload = operation.transaction;

        if (transactionPayload && !transactionPayload.posted) {
            return { result: false };
        }

        let responses: string[] = [];

        if (
            transactionPayload &&
            transactionPayload.properties &&
            transactionPayload.debitAccount &&
            transactionPayload.creditAccount &&
            transactionPayload.id
        ) {
            // Deleted Transaction is the purchase Transaction.
            if (
                transactionPayload.properties[QUANTITY_PROP] != undefined &&
                transactionPayload.properties[PURCHASE_CODE_PROP] != undefined &&
                transactionPayload.properties[PURCHASE_CODE_PROP] ==
                    transactionPayload.properties[PURCHASE_INVOICE_PROP]
            ) {
                const deletedTransactions = await this.deleteOnInventoryBook(
                    financialBook,
                    transactionPayload.id
                );
                if (deletedTransactions) {
                    responses = responses.concat(
                        await this.buildDeleteResults(deletedTransactions, financialBook)
                    );
                    const rebuildFlagMessage =
                        await this.botService.flagInventoryAccountForRebuildIfNeeded(
                            financialBook,
                            deletedTransactions[0]!
                        );
                    if (rebuildFlagMessage) {
                        responses.push(rebuildFlagMessage);
                    }
                }
            }

            // Deleted Transaction is an additional cost or credit note Transaction.
            if (
                transactionPayload.properties[PURCHASE_CODE_PROP] != undefined &&
                transactionPayload.properties[PURCHASE_CODE_PROP] !=
                    transactionPayload.properties[PURCHASE_INVOICE_PROP]
            ) {
                const inventoryBook = this.botService.getInventoryBook(financialBook);
                if (inventoryBook) {
                    const goodAccount = await optionalLookup(() =>
                        inventoryBook.getAccount(transactionPayload.creditAccount!.name)
                    );
                    if (goodAccount) {
                        const purchaseCode = transactionPayload.properties[PURCHASE_CODE_PROP];
                        const query = await this.getAccountQuery(inventoryBook, transactionPayload);
                        const transactions = (
                            await inventoryBook.listTransactions(query)
                        ).getItems();
                        for (const transaction of transactions) {
                            if (transaction.getProperty(PURCHASE_CODE_PROP) == purchaseCode) {
                                const originalQuantity = new Amount(
                                    transaction.getProperty(ORIGINAL_QUANTITY_PROP) ?? 0
                                ).toNumber();
                                const amount = new Amount(transaction.getAmount() ?? 0).toNumber();
                                if (originalQuantity != amount) {
                                    await goodAccount
                                        .setProperty(NEEDS_REBUILD_PROP, 'TRUE')
                                        .update();
                                    const warningMessage = `Flagging account ${goodAccount.getName()} for rebuild`;
                                    responses.push(warningMessage);
                                }
                                break;
                            }
                        }
                    }
                }
            }

            // Deleted Transaction is the sale Transaction.
            if (
                transactionPayload.properties[GOOD_PROP] != undefined &&
                transactionPayload.debitAccount.type == AccountType.INCOMING
            ) {
                const deletedTransactions = await this.deleteOnInventoryBook(
                    financialBook,
                    transactionPayload.id
                );
                if (deletedTransactions) {
                    const rebuildFlagMessage =
                        await this.botService.flagInventoryAccountForRebuildIfNeeded(
                            financialBook,
                            deletedTransactions[0]!
                        );
                    responses = responses.concat(
                        await this.buildDeleteResults(deletedTransactions, financialBook)
                    );
                    if (rebuildFlagMessage) {
                        responses.push(rebuildFlagMessage);
                    }
                }
            }

            // Deleted Transaction is a calculated COGS Transaction.
            if (isBotGeneratedCOGSTransaction(transactionPayload)) {
                const inventoryBook = this.botService.getInventoryBook(financialBook);
                if (inventoryBook && transactionPayload.remoteIds) {
                    for (const remoteId of transactionPayload.remoteIds) {
                        const inventoryBookTransaction = (
                            await inventoryBook.listTransactions(remoteId)
                        ).getFirst();
                        if (inventoryBookTransaction) {
                            const response = await this.botService.flagInventoryAccountForRebuild(
                                financialBook,
                                inventoryBookTransaction
                            );
                            if (response) {
                                responses.push(response);
                            }
                            break;
                        }
                    }
                }
            }

            return { result: responses.length > 0 ? responses : false };
        }

        return { result: false };
    }

    protected async deleteOnInventoryBook(
        financialBook: Book,
        remoteId: string
    ): Promise<Transaction[] | undefined> {
        let responses: Transaction[] | undefined = undefined;
        const inventoryBook = this.botService.getInventoryBook(financialBook);
        const deletedInventoryTransaction = inventoryBook
            ? await this.deleteTransactionByRemoteId(inventoryBook, remoteId)
            : undefined;
        if (deletedInventoryTransaction) {
            responses = [deletedInventoryTransaction];
            const inventoryResponses = await this.cascadeDeleteInventoryTransactions(
                inventoryBook!,
                deletedInventoryTransaction
            );
            const financialResponses = await this.cascadeDeleteFinancialTransactions(
                financialBook,
                deletedInventoryTransaction
            );
            if (inventoryResponses || financialResponses) {
                responses = responses
                    .concat(inventoryResponses ?? [])
                    .concat(financialResponses ?? []);
            }
        }
        return responses;
    }

    private async getAccountQuery(
        inventoryBook: Book,
        transaction: bkper.Transaction
    ): Promise<string> {
        let query = '';
        if (transaction.date && transaction.creditAccount) {
            const transactionDate = inventoryBook.parseDate(transaction.date);
            const timeRange = this.getTimeRange();

            const beforeDate = new Date(transactionDate.getTime() + timeRange);
            const beforeDateIsoString = inventoryBook.formatDate(
                beforeDate,
                inventoryBook.getTimeZone()
            );

            const afterDate = new Date(transactionDate.getTime() - timeRange);
            const afterDateIsoString = inventoryBook.formatDate(
                afterDate,
                inventoryBook.getTimeZone()
            );

            const inventoryAccount = await optionalLookup(() =>
                inventoryBook.getAccount(transaction.creditAccount!.name)
            );
            const inventoryAccountName = inventoryAccount?.getName();
            query = inventoryAccountName
                ? this.botService.getAccountQuery(
                      inventoryAccountName,
                      beforeDateIsoString,
                      afterDateIsoString
                  )
                : '';
        }
        return query;
    }

    /**
     * Gets the legacy approximate month range in milliseconds for querying additional costs and credits.
     */
    private getTimeRange(): number {
        return ADDITIONAL_COSTS_CREDITS_QUERY_RANGE * 30 * 24 * 60 * 60 * 1000;
    }
}
