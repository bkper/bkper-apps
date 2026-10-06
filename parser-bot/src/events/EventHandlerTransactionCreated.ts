import { Book, File, Transaction } from 'bkper-js';
import { AGENT_EXTRACTED_PROPERTY, AUTO_FILLED_DATE_PROPERTY, UPLOAD_METHOD_PROPERTY } from '../constants.js';
import { Result } from './event-handler.js';
import { EventHandler } from './EventHandler.js';
import { setAccountBasedOnAmount } from '../utils/transaction-utils.js';
import { Discovery } from '../services/DiscoveryService.js';
import { ExtractedTransaction } from '../genai/ExtractedTransaction.js';
import { AttachmentExtractionService } from '../services/AttachmentExtractionService.js';

export class EventHandlerTransactionCreated extends EventHandler {
    async handleEvent(book: Book, event: bkper.Event): Promise<Result> {
        const discovery: Discovery = this.context.createDiscovery();

        if (event.bookId && event.data) {
            let operation = event.data.object as bkper.TransactionOperation;
            let transaction = new Transaction(book, operation.transaction);

            // if (!transaction.getAmount() && !transaction.getDescription()) {
            //   return { result: 'Transaction does not have amount or description' };
            // }

            // OK to fill out ONLY amount or ONLY description

            // Get attachments
            const files = transaction.getFiles();
            if (files && files.length > 0) {


                // For simplicity, process the first attachment
                let file: File | undefined = files[0];

                file = await book.getFile(file.getId() || '');

                if (!file) {
                    console.log('File not found');
                    return { result: false };
                }

                console.log(file.getProperties());

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

                const needsTransactionExtraction = !transaction.getAmount() || !transaction.getDescription().trim();
                let extractedTransaction: ExtractedTransaction | undefined;
                let fileProperties: Record<string, string> | undefined;
                const attachmentExtractionService = new AttachmentExtractionService(this.context);
                try {
                    [extractedTransaction, fileProperties] = await Promise.all([
                        needsTransactionExtraction ? attachmentExtractionService.extractAttachedTransaction(book, transaction, file, account, group, promptResolution) : Promise.resolve(undefined),
                        attachmentExtractionService.extractFilePropertiesIfConfigured(book, transaction, file, account, group, filePrompt),
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

                if (!transaction.getAmount()) {
                    if (extractedTransaction?.amount) {
                        // Update transaction
                        transaction.setAmount(extractedTransaction.amount);
                        updatedFile = true;
                    } else {
                        // Extract amount from description using AI
                        const extractedAmount = await this.context.createExtractorAmount().extract(transaction.getDescription() || '');
                        if (extractedAmount && extractedAmount.gt(0)) {
                            transaction.setAmount(extractedAmount);
                            updatedProp = true;
                        }
                    }
                }

                if (!transaction.getDate() || transaction.getProperty(AUTO_FILLED_DATE_PROPERTY)) {
                    if (extractedTransaction?.date) {
                        transaction.setDate(extractedTransaction.date);
                        updatedFile = true;
                    } else {
                        // Extract date from description using AI
                        const extractedDate = await this.context.createExtractorDate().extract(transaction.getDescription() || '');
                        if (extractedDate) {
                            transaction.setDate(extractedDate);
                            updatedProp = true;
                        }
                    }
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

                const discoveryResult = await discovery.discover(transaction);

                if (discoveryResult.discovered) {
                    updatedProp = true;
                }

                if (updatedFile) {
                    transaction.setProperty(AGENT_EXTRACTED_PROPERTY, JSON.stringify(extractedTransaction));
                }

                if (updatedFile || updatedProp) {
                    await transaction.update();
                }

                if (fileMetadataUpdated) {
                    await file.update();
                }

                if (updatedFile || updatedProp || fileMetadataUpdated) {
                    return {
                        result: { prompt, transaction: extractedTransaction, fileProperties }
                    };
                }
            } else {
                let updated = false;
                const discoveryResult = await discovery.discover(transaction);
                if (discoveryResult.discovered) {
                    updated = true;
                }

                if (transaction.getAmount() == null) {
                    // Extract amount from description using AI
                    const extractedAmount = await this.context.createExtractorAmount().extract(transaction.getDescription() || '');
                    if (extractedAmount && extractedAmount.gt(0)) {
                        transaction.setAmount(extractedAmount);
                        updated = true;
                    }
                }

                if (transaction.getProperty(AUTO_FILLED_DATE_PROPERTY)) {
                    // Extract date from description using AI
                    const extractedDate = await this.context.createExtractorDate().extract(transaction.getDescription() || '');
                    if (extractedDate) {
                        transaction.setDate(extractedDate);
                        updated = true;
                    }
                }

                if (updated) {
                    await transaction.update();
                    return {
                        result: { transaction: transaction.payload }

                    };
                }
            }
        }

        return { result: false };
    }
}
