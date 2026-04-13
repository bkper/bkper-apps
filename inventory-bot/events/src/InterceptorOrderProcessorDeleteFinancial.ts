import { AccountType, Amount, Book, Transaction } from "bkper-js";
import { InterceptorOrderProcessorDelete } from "./InterceptorOrderProcessorDelete.js";
import { Result } from "./index.js";
import { GOOD_PROP, PURCHASE_CODE_PROP, PURCHASE_INVOICE_PROP, QUANTITY_PROP, COGS_HASHTAG, NEEDS_REBUILD_PROP, ADDITIONAL_COSTS_CREDITS_QUERY_RANGE, ORIGINAL_QUANTITY_PROP } from "./constants.js";
import { AppContext } from "./AppContext.js";

export class InterceptorOrderProcessorDeleteFinancial extends InterceptorOrderProcessorDelete {

    constructor(context: AppContext) {
        super(context);
    }

    async intercept(financialBook: Book, event: bkper.Event): Promise<Result> {
        if (!event.data) {
            return { result: false };
        }
        let operation = event.data.object as bkper.TransactionOperation;
        let transactionPayload = operation.transaction;

        if (transactionPayload && !transactionPayload.posted) {
            return { result: false };
        }

        let responses: string[] = [];

        if (transactionPayload && transactionPayload.properties && transactionPayload.debitAccount &&transactionPayload.creditAccount && transactionPayload.id) {

            // deleted transaction is the purchase transaction
            if (transactionPayload.properties[QUANTITY_PROP] != undefined && transactionPayload.properties[PURCHASE_CODE_PROP] != undefined && (transactionPayload.properties[PURCHASE_CODE_PROP] == transactionPayload.properties[PURCHASE_INVOICE_PROP])) {
                // delete root purchase transaction in the inventory book and all its splitted transactions
                const deletedTxs = await this.deleteOnInventoryBook(financialBook, transactionPayload.id);
                if (deletedTxs) {
                    responses = responses.concat(await this.buildDeleteResults(deletedTxs, financialBook));
                    const rebuildFlagMsg = await this.botService.flagInventoryAccountForRebuildIfNeeded(financialBook, deletedTxs[0]);
                    if (rebuildFlagMsg) {
                        responses.push(rebuildFlagMsg);
                    }
                }
            }

            // deleted transaction is the additional cost transaction or credit note transaction
            if (transactionPayload.properties[PURCHASE_CODE_PROP] != undefined && (transactionPayload.properties[PURCHASE_CODE_PROP] != transactionPayload.properties[PURCHASE_INVOICE_PROP])) {
                const inventoryBook = this.botService.getInventoryBook(financialBook);
                if (inventoryBook) {
                    const goodAccount = await inventoryBook.getAccount(transactionPayload.creditAccount.name);
                    if (goodAccount) {
                        const purchaseCode = transactionPayload.properties[PURCHASE_CODE_PROP];
                        // query for good account transactions within ADDITIONAL_COSTS_CREDITS_QUERY_RANGE time range and look for the purchase code property
                        // if found and it had already been processed by FIFO, flag the good account for rebuild
                        const query = await this.getAccountQuery(inventoryBook, transactionPayload);
                        const transactions = (await inventoryBook?.listTransactions(query)).getItems();
                        for (const transaction of transactions) {
                            if (transaction.getProperty(PURCHASE_CODE_PROP) == purchaseCode) {
                                const originalQuantity = new Amount(transaction.getProperty(ORIGINAL_QUANTITY_PROP) ?? 0).toNumber();
                                const amount = new Amount(transaction.getAmount() ?? 0).toNumber();
                                if (originalQuantity != amount) {
                                    // had already been processed by FIFO
                                    await goodAccount.setProperty(NEEDS_REBUILD_PROP, 'TRUE').update();
                                    const warningMsg = `Flagging account ${goodAccount.getName()} for rebuild`;
                                    responses.push(warningMsg);
                                }
                                break;
                            }
                        }
                    }
                }
            }

            // deleted transaction is the sale transaction
            if (transactionPayload.properties[GOOD_PROP] != undefined && transactionPayload.debitAccount.type == AccountType.INCOMING) {
                const deletedTxs = await this.deleteOnInventoryBook(financialBook, transactionPayload.id);
                if (deletedTxs) {
                    const rebuildFlagMsg = await this.botService.flagInventoryAccountForRebuildIfNeeded(financialBook, deletedTxs[0]);
                    responses = responses.concat(await this.buildDeleteResults(deletedTxs, financialBook));
                    if (rebuildFlagMsg) {
                        responses.push(rebuildFlagMsg);
                    }
                }
            }

            // deleted transaction is the COGS calculated transaction
            if (transactionPayload.agentId == 'inventory-bot' && transactionPayload.description?.includes(COGS_HASHTAG)) {
                const inventoryBook = this.botService.getInventoryBook(financialBook);
                if (inventoryBook && transactionPayload.remoteIds) {
                    for (const remoteId of transactionPayload.remoteIds) {
                        let inventoryBookTransaction = (await inventoryBook.listTransactions(remoteId)).getFirst();
                        if (inventoryBookTransaction) {
                            const response = await this.botService.flagInventoryAccountForRebuild(financialBook, inventoryBookTransaction);
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

    protected async deleteOnInventoryBook(financialBook: Book, remoteId: string): Promise<Transaction[] | undefined> {
        let responses: Transaction[] | undefined = undefined;
        let inventoryBook = this.botService.getInventoryBook(financialBook);
        const deletedInventoryTx = inventoryBook ? await this.deleteTransactionByRemoteId(inventoryBook, remoteId) : undefined;
        if (deletedInventoryTx) {
            responses = [deletedInventoryTx];
            const inventoryResponses = await this.cascadeDeleteInventoryTransactions(inventoryBook!, deletedInventoryTx);
            const financialResponses = await this.cascadeDeleteFinancialTransactions(financialBook!, deletedInventoryTx);
            if (inventoryResponses || financialResponses) {
                responses = responses.concat(inventoryResponses ?? []).concat(financialResponses ?? []);
            }
        }
        return responses;
    }

    private async getAccountQuery(inventoryBook: Book, transaction: bkper.Transaction): Promise<string> {
        let query = '';
        if (transaction.date && transaction.creditAccount) {
            const transactionDate = inventoryBook.parseDate(transaction.date);
            const timeRange = this.getTimeRange();

            // Calculate the range in months to query for the additional cost and credit note transactions
            const beforeDate = new Date(transactionDate.getTime() + timeRange);
            const beforeDateIsoString = inventoryBook.formatDate(beforeDate, inventoryBook.getTimeZone());

            const afterDate = new Date(transactionDate.getTime() - timeRange);
            const afterDateIsoString = inventoryBook.formatDate(afterDate, inventoryBook.getTimeZone());

            // Get inventory account details and build query
            const inventoryAccount = await inventoryBook.getAccount(transaction.creditAccount.name);
            const inventoryAccountName = inventoryAccount ? inventoryAccount.getName() : undefined;
            query = inventoryAccountName ? this.botService.getAccountQuery(inventoryAccountName, beforeDateIsoString, afterDateIsoString) : '';
        }
        return query;
    }

    /**
     * Gets the time range in milliseconds for querying additional costs and credits
     * Calculated as: ADDITIONAL_COSTS_CREDITS_QUERY_RANGE * 30 days * 24 hours * 60 minutes * 60 seconds * 1000 milliseconds
     * @returns Time range in milliseconds
     */
    private getTimeRange(): number {
        return ADDITIONAL_COSTS_CREDITS_QUERY_RANGE * 30 * 24 * 60 * 60 * 1000;
    }

}