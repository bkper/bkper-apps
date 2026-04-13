import { Result } from "./index.js";
import { BotService } from "./BotService.js";
import { AppContext } from "./AppContext.js";
import { Book } from "bkper-js";

export class EventHandlerTransactionPosted {

	protected botService: BotService;
	protected context: AppContext;

	constructor(context: AppContext) {
		this.context = context;
		this.botService = new BotService(context);
	}

	async handleEvent(event: bkper.Event): Promise<Result> {
		const eventBook = new Book(event.book, this.context.bkper.getConfig());

		// prevent response to transactions posted in the inventory book
		if (this.botService.isInventoryBook(eventBook)) {
			// delete posted transaction and warn the user
			if (event.data) {
				if (!event.data.object) {
					return { result: false };
				}
				const operation = event.data.object as bkper.TransactionOperation;
				const transactionPayload = operation.transaction;
				const transaction = (await eventBook.listTransactions(transactionPayload!.id!)).getFirst();
				if (transaction) {
					await this.botService.uncheckAndTrash(transaction);
				}
				const warningMsg = `You can't post directly in the Inventory book. Transaction deleted.`;

				return { warning: warningMsg };
			}
		}
		return { result: false };
	}

}