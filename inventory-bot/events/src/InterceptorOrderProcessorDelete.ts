import { Book, Transaction } from "bkper-js";
import { ORIGINAL_QUANTITY_PROP, PARENT_ID_PROP } from "./constants.js";
import { AppContext } from "./AppContext.js";
import { BotService } from "./BotService.js";

export abstract class InterceptorOrderProcessorDelete {

	protected context: AppContext;
	protected botService: BotService;

	constructor(context: AppContext) {
		this.context = context;
		this.botService = new BotService(context);
	}

	protected async cascadeDeleteInventoryTransactions(inventoryBook: Book, deletedTx: bkper.Transaction | Transaction): Promise<Transaction[] | undefined> {
		let responses: Transaction[] = [];

		const transactionId = deletedTx instanceof Transaction ? deletedTx.getId() : deletedTx.id;
		const originalQuantity = deletedTx instanceof Transaction ? deletedTx.getProperty(ORIGINAL_QUANTITY_PROP) : deletedTx.properties?.[ORIGINAL_QUANTITY_PROP];
		const accountName = deletedTx instanceof Transaction ? await deletedTx.getDebitAccountName() : deletedTx.debitAccount?.name;

		// splitted purchase transactions in inventory book
		if (originalQuantity) {
			const goodAccountTransactions = (await inventoryBook.listTransactions(`account:'${accountName}'`)).getItems();
			for (const transaction of goodAccountTransactions) {
				const parentIdProp = transaction.getProperty(PARENT_ID_PROP);
				if (parentIdProp == transactionId) {
					// transaction is a splitted transaction
					responses.push(await this.botService.uncheckAndTrash(transaction));
				}
			}
		}

		return responses.length > 0 ? responses : undefined;
	}

	protected async cascadeDeleteFinancialTransactions(financialBook: Book, remoteTx: bkper.Transaction | Transaction): Promise<Transaction[] | undefined> {
		let responses: Transaction[] | undefined = undefined;

		const remoteId = remoteTx instanceof Transaction ? remoteTx.getId() : remoteTx.id;

		// COGS transaction in financial book
		let tx = (await financialBook.listTransactions(`remoteId:${remoteId}`)).getFirst();
		if (tx) {
			if (tx.isChecked()) {
				tx = await tx.uncheck();
			}
			responses = [];
			responses.push(await tx.trash());
			return responses;
		}

		return responses;
	}

	protected async buildDeleteResults(responses: Transaction[], book?: Book): Promise<string[]> {
		let results: string[] = [];
		for (const response of responses) {
			const bookAnchor = book ? this.botService.buildBookAnchor(book) : undefined;
			bookAnchor ? results.push(`${bookAnchor}: ${await this.buildDeleteResponse(response)}`) : results.push(`${await this.buildDeleteResponse(response)}`);
		}
		return results;
	}

	protected async buildDeleteResponse(tx: Transaction): Promise<string> {
		return `DELETED: ${tx.getDateFormatted()} ${tx.getAmount()} ${await tx.getCreditAccountName()} ${await tx.getDebitAccountName()} ${tx.getDescription()}`
	}

	protected async deleteTransactionByRemoteId(book: Book, remoteId?: string): Promise<Transaction | undefined> {
		let tx = remoteId ? (await book.listTransactions(`remoteId:${remoteId}`)).getFirst() : undefined;
		if (tx) {
			tx = await this.botService.uncheckAndTrash(tx);
			return tx;
		}
		return undefined;
	}

}