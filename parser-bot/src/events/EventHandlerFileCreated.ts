import { Account, Amount, Book, File, Transaction } from 'bkper-js';
import { AGENT_EXTRACTED_PROPERTY, AGENT_FILE_ID_PROPERTY, TRANSACTIONS_SUMMARY_PROPERTY, UPLOAD_METHOD_PROPERTY } from '../constants.js';
import { ExtractedTransaction } from '../genai/ExtractedTransaction.js';
import { Result } from './event-handler.js';
import { EventHandler } from './EventHandler.js';
import { setAccountBasedOnAmount } from '../utils/transaction-utils.js';
import { Discovery } from '../services/DiscoveryService.js';
import { FileParsingResult } from '../file-parsers/FileParserInterfaces.js';
import { FileParserRouter } from '../file-parsers/FileParserRouter.js';

interface TransactionRecording {
    extracted: ExtractedTransaction;
    transactionId?: string;
}

interface TransactionBatchResult {
    recordings: TransactionRecording[];
    transactions: Transaction[];
}

interface TransactionsSummaryEntry {
    bookId: string;
    accountId: string;
    total_transactions: number;
    transactionIds: string[];
}

interface AccountSummary {
    totalTransactions: number;
    transactionIds: string[];
}

export class EventHandlerFileCreated extends EventHandler {
    async handleEvent(book: Book, event: bkper.Event): Promise<Result> {
        let transactions: ExtractedTransaction[] = [];
        let prompt: string | undefined;
        let fileProperties: Record<string, string> | undefined;
        const fileEventObj = event.data?.object as bkper.File | undefined;

        if (!event.bookId || !fileEventObj?.id) {
            return { result: { prompt, transactions } };
        }

        const file = await book.getFile(fileEventObj.id);
        if (!file) {
            console.log('File not found');
            return { result: false };
        }

        if (file.getProperty(UPLOAD_METHOD_PROPERTY, 'upload_method_') == 'attachment') {
            console.log('File was created from an attachment');
            return { result: false };
        }

        if (file.getProperty(TRANSACTIONS_SUMMARY_PROPERTY)) {
            console.log('File already has a transactions summary; skipping extraction');
            return { result: false };
        }

        try {
            const extraction = await new FileParserRouter(this.context).parse(book, file);

            prompt = extraction.prompt;
            transactions = extraction.transactions;

            const recorded = await this.recordExtraction(book, file, extraction);
            fileProperties = recorded.filePropertiesUpdated;
        } catch (error) {
            console.error('File extraction failed:', error);
            return { error: `File extraction failed: ${error}` };
        }

        return {
            result: { prompt, transactions, ...(fileProperties ? { fileProperties } : {}) }
        };
    }

    private async recordExtraction(book: Book, file: File, extraction: FileParsingResult): Promise<{ filePropertiesUpdated: Record<string, string> | undefined }> {
        let shouldUpdateFile = false;
        let filePropertiesUpdated: Record<string, string> | undefined;

        if (extraction.transactions.length > 0) {
            if (extraction.kind === 'transaction') {
                const recording = await this.recordTransaction(extraction.transactions[0], book, file, extraction.account);
                shouldUpdateFile = this.recordSingleTransactionSummaryToFile(recording, book, file, extraction.account);
            } else {
                const recordings = this.createTransactionRecordings(extraction.transactions);
                await this.recordTransactionRecordings(recordings, book, file, extraction.account);
                shouldUpdateFile = await this.recordSummaryToFile(recordings, book, file, extraction.account);
            }
        }

        const filePropertyEntries = Object.entries(extraction.fileProperties ?? {}).sort(([left], [right]) => left.localeCompare(right));
        if (filePropertyEntries.length > 0) {
            // Persist extracted metadata and mirror it in the handler result.
            for (const [key, value] of filePropertyEntries) {
                file.setProperty(key, value);
            }
            filePropertiesUpdated = Object.fromEntries(filePropertyEntries);
            shouldUpdateFile = true;
        }

        if (shouldUpdateFile) {
            await file.update();
        }

        return { filePropertiesUpdated };
    }

    /**
     * Single invoice/receipt path — builds the transaction, attaches the source file, runs discovery to enrich account sides and properties, and persists it immediately via API.
     */
    async recordTransaction(tx: ExtractedTransaction, book: Book, file: File, account: Account | undefined): Promise<TransactionRecording> {
        const discovery: Discovery = this.context.createDiscovery();
        const recording = this.createTransactionRecordings([tx])[0];
        const transaction = this.assembleTransaction(book, recording.extracted, account);
        transaction.addFile(file);

        // Run discovery once for the transaction.
        const discoveryStartedAt = this.logDiscoveryStarted(1);
        try {
            const discoveryResult = await discovery.discover(transaction);
            if (account && discoveryResult.dataSet) {
                await discovery.discoverProperties(account, transaction, discoveryResult.dataSet);
            }
        } finally {
            this.logDiscoveryFinished(discoveryStartedAt);
        }

        await transaction.create();
        recording.transactionId = transaction.getId();
        return recording;
    }

    /**
     * Groups extracted transactions by target book and dispatches each group to be sorted, built, enriched, and batch-created.
     */
    async recordTransactions(txs: ExtractedTransaction[], book: Book, file: File, account: Account | undefined): Promise<TransactionBatchResult[]> {
        const recordings = this.createTransactionRecordings(txs);
        return this.recordTransactionRecordings(recordings, book, file, account);
    }

    private createTransactionRecordings(txs: ExtractedTransaction[]): TransactionRecording[] {
        return txs.map(extracted => ({ extracted }));
    }

    private async recordTransactionRecordings(recordings: TransactionRecording[], book: Book, file: File, account: Account | undefined): Promise<TransactionBatchResult[]> {
        const defaultBookId = book.getId() || '';
        const recordingsByBook = this.groupTransactionRecordingsByBook(recordings, defaultBookId);
        const createdBatches: TransactionBatchResult[] = [];

        // Collect each target-book batch result while preserving sequential creation.
        for (const [bookId, bookRecordings] of recordingsByBook) {
            createdBatches.push(await this.recordTransactionsForBook(bookId, bookRecordings, book, file, account));
        }

        return createdBatches;
    }

    /**
     * Resolves the target book, sorts transactions oldest-to-newest, builds each one with discovery, then batch-creates them all.
     */
    private async recordTransactionsForBook(bookId: string, bookRecordings: TransactionRecording[], defaultBook: Book, file: File, defaultAccount: Account | undefined): Promise<TransactionBatchResult> {
        const isOriginalBook = bookId === (defaultBook.getId() || '');
        const targetBook = await this.resolveBook(bookId, defaultBook);

        // Sort transactions with clear dates from oldest to newest; keep undated transactions last and stable.
        const sortedRecordings = [...bookRecordings].sort((a, b) => this.compareExtractedTransactionDates(a.extracted, b.extracted));
        const discovery: Discovery = this.context.createDiscovery();
        const transactions: Transaction[] = [];

        // Run discovery once for the whole transaction batch.
        const discoveryStartedAt = this.logDiscoveryStarted(sortedRecordings.length);
        try {
            for (const recording of sortedRecordings) {
                const account = await this.resolveTargetAccount(recording.extracted, targetBook, defaultAccount, isOriginalBook);
                const transaction = await this.buildTransaction(recording.extracted, targetBook, account, file, discovery);
                transactions.push(transaction);
            }
        } finally {
            this.logDiscoveryFinished(discoveryStartedAt);
        }

        const createdTransactions = await targetBook.batchCreateTransactions(transactions);

        // Associate returned native IDs with recordings in the same batch position.
        for (const [index, createdTransaction] of createdTransactions.entries()) {
            const recording = sortedRecordings[index];
            if (recording) {
                recording.transactionId = createdTransaction.getId();
            }
        }

        console.log(`Created ${transactions.length} transactions in book '${targetBook.getId()}'`);

        return {
            recordings: sortedRecordings,
            transactions: createdTransactions,
        };
    }


    /**
     * Constructs a single bkper Transaction from an extracted transaction and enriches it — sets the file ID property, runs account discovery, and if successful, discovers common properties from similar past transactions.
     */
    private async buildTransaction(tx: ExtractedTransaction, book: Book, account: Account | undefined, file: File, discovery: Discovery): Promise<Transaction> {
        const transaction = this.assembleTransaction(book, tx, account);
        await this.enrichTransaction(transaction, file, account, discovery);
        return transaction;
    }

    /**
     * Tags the transaction with the originating file ID, runs account discovery to fill in credit/debit sides, and if a matching dataset is found, discovers and adds common properties from past transactions.
     */
    private async enrichTransaction(transaction: Transaction, file: File, account: Account | undefined, discovery: Discovery): Promise<void> {
        transaction.setProperty(AGENT_FILE_ID_PROPERTY, file.getId() || '');

        // Enrich transaction via discovery and optionally discover account properties
        const discoveryResult = await discovery.discover(transaction);
        if (account && discoveryResult.dataSet) {
            await discovery.discoverProperties(account, transaction, discoveryResult.dataSet);
        }
    }

    /**
     * Resolve the account for a single transaction — named override, default, or undefined for cross-book
     */
    private async resolveTargetAccount(tx: ExtractedTransaction, targetBook: Book, defaultAccount: Account | undefined, isOriginalBook: boolean): Promise<Account | undefined> {
        if (tx.account_name) {
            // Named override: look up by account_name in the target book
            const account = await targetBook.getAccount(tx.account_name);
            if (!account) {
                console.warn(`Account '${tx.account_name}' not found in book '${targetBook.getId()}', recording without account`);
            }
            return account;
        }
        if (isOriginalBook) {
            // No override: use the default account for the original book
            return defaultAccount;
        }
        // Cross-book transaction with no account_name: leave account undefined
        return undefined;
    }

    /**
     * Return the correct Book instance — original if bookId matches, or fetch it from the API
     */
    private async resolveBook(bookId: string, defaultBook: Book): Promise<Book> {
        if (bookId === (defaultBook.getId() || '')) {
            return defaultBook;
        }
        console.log(`Fetching target book: ${bookId}`);
        return this.context.bkper.getBook(bookId);
    }

    /**
     * Group transaction recordings by book_id, using defaultBookId when no override is present.
     */
    private groupTransactionRecordingsByBook(recordings: TransactionRecording[], defaultBookId: string): Map<string, TransactionRecording[]> {
        const groups = new Map<string, TransactionRecording[]>();

        for (const recording of recordings) {
            const bookId = recording.extracted.book_id || defaultBookId;
            const bookRecordings = groups.get(bookId) ?? [];
            bookRecordings.push(recording);
            groups.set(bookId, bookRecordings);
        }

        return groups;
    }

    /**
     * Build and save the one-entry transactions_summary for a single transaction extraction.
     */
    private recordSingleTransactionSummaryToFile(recording: TransactionRecording, book: Book, file: File, account: Account | undefined): boolean {
        if (this.isZeroAmount(recording.extracted.amount)) {
            return false;
        }

        const summary: TransactionsSummaryEntry[] = [{
            bookId: book.getId() || '',
            accountId: account?.getId() || '',
            total_transactions: 1,
            transactionIds: [recording.transactionId!],
        }];
        file.setProperty(TRANSACTIONS_SUMMARY_PROPERTY, JSON.stringify(summary));
        return true;
    }

    /**
     * Build and save a transactions_summary property on the file —
     * one entry per (bookId, accountId) pair describing how many non-zero transactions were recorded
     */
    private async recordSummaryToFile(recordings: TransactionRecording[], book: Book, file: File, account: Account | undefined): Promise<boolean> {
        // Ignore zero-amount extracted entries in the summary while still allowing them to be recorded.
        const summaryRecordings = recordings.filter((recording) => !this.isZeroAmount(recording.extracted.amount));
        if (summaryRecordings.length === 0) {
            return false;
        }

        const defaultBookId = book.getId() || '';
        const recordingsByBook = this.groupTransactionRecordingsByBook(summaryRecordings, defaultBookId);
        const summary: TransactionsSummaryEntry[] = [];

        for (const [bookId, bookRecordings] of recordingsByBook) {
            const isOriginalBook = bookId === defaultBookId;
            const targetBook = await this.resolveBook(bookId, book);

            // Sub-group transactions within this book by their effective account key.
            const summaryByAccount = new Map<string, AccountSummary>();
            for (const recording of bookRecordings) {
                const tx = recording.extracted;
                let accountKey: string;
                if (tx.account_name) {
                    // Named override — use account_name as key; resolve to ID below.
                    accountKey = tx.account_name;
                } else if (isOriginalBook && account) {
                    // Default account for the original book — use ID directly, no lookup needed.
                    accountKey = account.getId() || '';
                } else {
                    // Cross-book with no account_name — unresolvable.
                    accountKey = '';
                }

                const accountSummary = summaryByAccount.get(accountKey) ?? { totalTransactions: 0, transactionIds: [] };
                accountSummary.totalTransactions += 1;
                accountSummary.transactionIds.push(recording.transactionId!);
                summaryByAccount.set(accountKey, accountSummary);
            }

            // Resolve each account key to a final accountId and build summary entries.
            for (const [accountKey, accountSummary] of summaryByAccount) {
                let accountId: string;
                if (!accountKey) {
                    // Unresolvable: cross-book with no account_name.
                    accountId = '';
                } else if (isOriginalBook && account && accountKey === (account.getId() || '')) {
                    // Already an ID (default account of original book).
                    accountId = accountKey;
                } else {
                    // Named override — look up in the target book to get the ID.
                    const resolved = await targetBook.getAccount(accountKey);
                    accountId = resolved?.getId() || '';
                }
                summary.push({
                    bookId,
                    accountId,
                    total_transactions: accountSummary.totalTransactions,
                    transactionIds: accountSummary.transactionIds,
                });
            }
        }

        file.setProperty(TRANSACTIONS_SUMMARY_PROPERTY, JSON.stringify(summary));
        return true;
    }

    private isZeroAmount(amount: unknown): boolean {
        if (amount === null || amount === undefined || amount === '') {
            return false;
        }

        // Parse numeric and string amounts so values like "0" and "0.00" are also excluded.
        try {
            return new Amount(amount as number | string | Amount).eq(0);
        } catch {
            return false;
        }
    }

    /**
     * Log the start of a discovery batch and return its timestamp for elapsed time measurement.
     */
    private logDiscoveryStarted(transactionCount: number): number {
        const label = transactionCount === 1 ? 'tx' : 'txs';
        console.log(`Discovery started (${transactionCount} ${label})`);
        return Date.now();
    }

    /**
     * Log the elapsed time for a completed discovery batch.
     */
    private logDiscoveryFinished(startedAt: number): void {
        console.log(`Discovery finished in ${Date.now() - startedAt}ms`);
    }

    private compareExtractedTransactionDates(a: ExtractedTransaction, b: ExtractedTransaction): number {
        const aDate = this.normalizeExtractedDate(a.date);
        const bDate = this.normalizeExtractedDate(b.date);

        if (aDate && bDate) {
            return aDate.localeCompare(bDate);
        }
        if (aDate) {
            return -1;
        }
        if (bDate) {
            return 1;
        }
        return 0;
    }

    private normalizeExtractedDate(date: ExtractedTransaction['date'] | undefined): string | undefined {
        if (!date) {
            return undefined;
        }

        const trimmedDate = date.trim();
        if (!trimmedDate || trimmedDate.toLowerCase() === 'null' || trimmedDate.toLowerCase() === 'undefined') {
            return undefined;
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
            console.warn(`Ignoring extracted date that is not ISO YYYY-MM-DD: ${trimmedDate}`);
            return undefined;
        }

        return trimmedDate;
    }

    /**
     * Assembles a local Transaction object from extracted data — normalises property values to strings, sets amount/description/date as draft, stores the original extraction payload as a property, and assigns account sides based on the amount sign.
     */
    private assembleTransaction(book: Book, extractedTransaction: ExtractedTransaction, account: Account | undefined): Transaction {
        // Convert property values to strings (bkper.Transaction expects string properties)
        const properties: { [key: string]: string } = {};
        if (extractedTransaction.properties) {
            for (const key in extractedTransaction.properties) {
                properties[key] = String(extractedTransaction.properties[key]);
            }
        }

        const tx: bkper.Transaction = {
            amount: `${extractedTransaction.amount}`,
            description: extractedTransaction.description,
            properties,
            // Force create as draft no matter auto-post setting
            draft: true
        };

        const extractedDate = this.normalizeExtractedDate(extractedTransaction.date);
        if (extractedDate) {
            tx.date = extractedDate;
        }

        const transaction = new Transaction(book, tx);
        transaction.setProperty(AGENT_EXTRACTED_PROPERTY, JSON.stringify(extractedTransaction));
        if (account && extractedTransaction.amount) {
            const amount = new Amount(extractedTransaction.amount);
            setAccountBasedOnAmount(transaction, account, amount);
        }
        return transaction;
    }
}
