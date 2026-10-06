import { Book, Transaction } from 'bkper-js';
import { Result } from './event-handler.js';
import { EventHandler } from './EventHandler.js';
import { StatementPromptImprovementService } from '../services/StatementPromptImprovementService.js';
import { AppContext } from '../AppContext.js';

/**
 * Handler for TRANSACTION_DELETED events.
 * Flags statements for improvement when transactions are deleted,
 * indicating false positives in AI extraction.
 */
export class EventHandlerTransactionDeleted extends EventHandler {
    private statementPromptImprovementService: StatementPromptImprovementService;

    constructor(context: AppContext) {
        super(context);
        this.statementPromptImprovementService = new StatementPromptImprovementService(context);
    }

    async handleEvent(book: Book, event: bkper.Event): Promise<Result> {
        console.log('TRANSACTION_DELETED event - checking if statement needs improvement...');

        const operation = event.data?.object as bkper.TransactionOperation;
        const transactionPayload = operation?.transaction;
        if (!transactionPayload?.id) {
            return { result: 'No transaction ID in event' };
        }

        const transaction = new Transaction(book, { ...transactionPayload, trashed: true });
        const flagged = await this.statementPromptImprovementService.flagStatementForImprovement(book, transaction);

        if (flagged) {
            return { result: 'Statement flagged for improvement after transaction deletion' };
        }

        return { result: 'No flagging needed' };
    }
}
