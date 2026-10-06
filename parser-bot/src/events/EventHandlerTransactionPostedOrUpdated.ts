import { Book, Transaction } from 'bkper-js';
import { InvoicePromptImprovementService } from '../services/InvoicePromptImprovementService.js';
import { StatementPromptImprovementService } from '../services/StatementPromptImprovementService.js';
import { Result } from './event-handler.js';
import { EventHandler } from './EventHandler.js';
import { AppContext } from '../AppContext.js';

export class EventHandlerTransactionPostedOrUpdated extends EventHandler {
    private promptImprovementService: InvoicePromptImprovementService;
    private statementPromptImprovementService: StatementPromptImprovementService;

    constructor(context: AppContext) {
        super(context);
        this.promptImprovementService = new InvoicePromptImprovementService(context);
        this.statementPromptImprovementService = new StatementPromptImprovementService(context);
    }

    async handleEvent(book: Book, event: bkper.Event): Promise<Result> {
        const operation = event.data?.object as bkper.TransactionOperation;

        const transaction = operation.transaction;

        if (!transaction?.posted) {
            console.log('Transaction is not posted');
            return { result: false };
        }
        const promises: Array<Promise<string | null>> = [];

        // Invoice ACE (sync) - unchanged
        promises.push(this.promptImprovementService.improveInvoicePrompt(book, new Transaction(book, transaction)));

        // Statement flagging (async preparation) - uses dedicated service
        promises.push(this.statementPromptImprovementService.flagStatementForImprovement(book, new Transaction(book, transaction)));

        promises.push(this.context.createRediscoveryService().rediscover(book, new Transaction(book, transaction), event));
        const returns = await Promise.all(promises);

        const result: Result = { result: false };
        for (const ret of returns) {
            if (ret != null) {
                if (result.result) {
                    result.result += `\n\n${ret}`;
                } else {
                    result.result = ret;
                }
            }
        }

        return result;
    }
}
