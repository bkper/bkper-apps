import { Book, Transaction } from 'bkper-js';
import { EXTRACTOR_FILE_ID_PROPERTY, LEGACY_AGENT_FILE_ID_PROPERTY } from '../constants.js';
import { Result } from './event-handler.js';
import { EventHandler } from './EventHandler.js';

/**
 * Bookbot's created job: complete a typed draft from its description and posted history, then update it once.
 * Drafts with files belong to Extractor Bot, which reads the document and asks Bookbot's API to complete them.
 */
export class EventHandlerTransactionCreated extends EventHandler {
    async handleEvent(book: Book, event: bkper.Event): Promise<Result> {
        const operation = event.data?.object as bkper.TransactionOperation;
        const transaction = new Transaction(book, operation.transaction);

        if (transaction.getFiles().length > 0) {
            return { result: false };
        }

        // Drafts recorded from a file by another app, which completes them before recording.
        if (transaction.getProperty(EXTRACTOR_FILE_ID_PROPERTY, LEGACY_AGENT_FILE_ID_PROPERTY)) {
            return { result: false };
        }

        // The amount and date help rank discovered Accounts, so complete them first.
        const completed = await this.context.createDescriptionCompletion().complete(transaction);
        const discoveryResult = await this.context.createDiscovery().discover(transaction);

        if (completed || discoveryResult.discovered) {
            await transaction.update();
            return { result: { transaction: transaction.payload } };
        }

        return { result: false };
    }
}
