import { Book, File, Transaction } from 'bkper-js';
import { AUTO_FILLED_DATE_PROPERTY, EXTRACTOR_EXTRACTED_PROPERTY, PARSER_URL_OWNED_LOG, UPLOAD_METHOD_PROPERTY } from '../constants.js';
import { Result } from './event-handler.js';
import { EventHandler } from './EventHandler.js';
import { setAccountBasedOnAmount } from '../utils/transaction-utils.js';
import { DiscoveryError } from '../services/BookbotDiscoveryClient.js';
import { ExtractedTransaction } from '../genai/ExtractedTransaction.js';
import { AttachmentExtractionService } from '../services/AttachmentExtractionService.js';

export class EventHandlerTransactionCreated extends EventHandler {
    async handleEvent(book: Book, event: bkper.Event): Promise<Result> {
        let warning: string | undefined;

        if (event.bookId && event.data) {
            let operation = event.data.object as bkper.TransactionOperation;
            let transaction = new Transaction(book, operation.transaction);

            // if (!transaction.getAmount() && !transaction.getDescription()) {
            //   return { result: 'Transaction does not have amount or description' };
            // }

            // OK to fill out ONLY amount or ONLY description

            // Get attachments. Extractor Bot reads only documents: transactions without files are typed drafts,
            // which Bookbot completes, or drafts recorded from a file, completed before recording.
            const files = transaction.getFiles();
            if (files && files.length > 0) {


                // For simplicity, process the first attachment
                let file: File | undefined = files[0];

                file = await book.getFile(file.getId() || '');

                if (!file) {
                    console.log('File not found');
                    return { result: false };
                }

                console.log('File properties:', Object.keys(file.getProperties()).join(', '));

                // Check UPLOAD_METHOD_PROPERTY
                if (file.getProperty(UPLOAD_METHOD_PROPERTY, 'upload_method_') != 'attachment') {
                    console.log('File was not created from an attachment');
                    return { result: false };
                }

                const promptContext = await this.context.promptLookupService.lookupPrompts({ book, transaction, file });
                const promptResolution = promptContext?.getPrompt('transaction');
                const filePrompt = promptContext?.getPrompt('file');
                const prompt = promptResolution?.prompt;
                const account = promptResolution?.account ?? promptContext?.account;
                const group = promptResolution?.group ?? promptContext?.group;

                // A parser URL for the attachment gives it to another app.
                const parserLookups = await Promise.all([
                    this.context.promptLookupService.lookupParserUrl({ book, transaction, file, account, group, purpose: 'transaction' }),
                    this.context.promptLookupService.lookupParserUrl({ book, transaction, file, account, group, purpose: 'file' }),
                ]);
                if (parserLookups.some(lookup => !!lookup)) {
                    console.log(PARSER_URL_OWNED_LOG);
                    return { result: false };
                }

                const needsTransactionExtraction = !transaction.getAmount() || !transaction.getDescription().trim();
                let extractedTransaction: ExtractedTransaction | undefined;
                let fileProperties: Record<string, string> | undefined;
                const attachmentExtractionService = new AttachmentExtractionService(this.context);
                try {
                    [extractedTransaction, fileProperties] = await Promise.all([
                        needsTransactionExtraction ? attachmentExtractionService.extractAttachedTransaction(file, promptResolution) : Promise.resolve(undefined),
                        attachmentExtractionService.extractFilePropertiesIfConfigured(file, filePrompt),
                    ]);
                } catch (error) {
                    console.error('Attachment extraction failed:', error);
                    return { error: `Attachment extraction failed: ${error}` };
                }

                let updatedFile = false;
                let updatedProp = false;
                let fileMetadataUpdated = false;

                if (extractedTransaction?.description && !transaction.getDescription().trim()) {
                    // Update transaction
                    transaction.setDescription(extractedTransaction.description);
                    updatedFile = true;
                }

                // An amount or date the document lacks is read from the description by Bookbot, which completes the draft below.
                if (!transaction.getAmount() && extractedTransaction?.amount) {
                    transaction.setAmount(extractedTransaction.amount);
                    updatedFile = true;
                }

                if ((!transaction.getDate() || transaction.getProperty(AUTO_FILLED_DATE_PROPERTY)) && extractedTransaction?.date) {
                    transaction.setDate(extractedTransaction.date);
                    // The document chose the date: it is no longer automatically filled, so Bookbot keeps it.
                    transaction.deleteProperty(AUTO_FILLED_DATE_PROPERTY);
                    updatedFile = true;
                }

                if (extractedTransaction?.properties && Object.keys(extractedTransaction.properties).length > 0) {
                    let extractedPropertyUpdated = false;
                    for (const key in extractedTransaction.properties) {
                        const value = String(extractedTransaction.properties[key]);
                        if (transaction.getProperty(key) !== value) {
                            extractedPropertyUpdated = true;
                        }
                        transaction.setProperty(key, value);
                    }
                    if (extractedPropertyUpdated) {
                        updatedFile = true;
                    }
                }

                if (setAccountBasedOnAmount(transaction, account, transaction.getAmount())) {
                    updatedProp = true;
                }

                if (fileProperties && Object.keys(fileProperties).length > 0) {
                    for (const [key, value] of Object.entries(fileProperties)) {
                        file.setProperty(key, value);
                    }
                    fileMetadataUpdated = true;
                }

                const discoveryResult = await this.context.createBookbotDiscoveryClient().discover(book.getId() || '', [{ transaction }]);

                if (discoveryResult.outcomes[0] === 'changed') {
                    updatedProp = true;
                }
                warning = this.discoveryWarning(discoveryResult.error);

                if (updatedFile) {
                    transaction.setProperty(EXTRACTOR_EXTRACTED_PROPERTY, JSON.stringify(extractedTransaction));
                }

                if (updatedFile || updatedProp) {
                    await transaction.update();
                }

                if (fileMetadataUpdated) {
                    await file.update();
                }

                if (updatedFile || updatedProp || fileMetadataUpdated) {
                    return {
                        result: { prompt, transaction: extractedTransaction, fileProperties },
                        ...(warning ? { warning } : {}),
                    };
                }
            }
        }

        // Report a discovery failure even when nothing else changed.
        return warning ? { warning } : { result: false };
    }

    private discoveryWarning(error: DiscoveryError | undefined): string | undefined {
        return error ? `Account discovery failed (${error.code}); the transaction was left without discovered Accounts.` : undefined;
    }
}
