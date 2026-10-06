import { File, Book, Account, Group } from 'bkper-js';
import { ExternalExtractorRequest, ExternalExtractorResponse, ExternalExtractorResult } from './ExternalExtractorTypes.js';
import { ExtractedTransaction } from '../genai/ExtractedTransaction.js';
import { ExtractorUrlLookupResult } from '../services/PromptLookupService.js';

/**
 * Signals a deterministic failure that must not be retried.
 * Used for application-level errors and non-rate-limit 4xx client errors.
 */
class NonRetryableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NonRetryableError';
    }
}

/**
 * HTTP client for external parser services.
 * Provides retry logic with exponential backoff (consistent with Gemini extractors).
 */
export class ExternalExtractorClient {
    private readonly MAX_RETRIES = 3;
    private readonly INITIAL_DELAY_MS = 1000;
    private readonly TIMEOUT_MS = 600000; // 10 minutes

    constructor(private url: string) { }

    /**
     * Extract multiple transactions using external service.
     * The transactions operation consumes only data.transactions.
     */
    async extract(file: File, book: Book, account: Account, lookup: ExtractorUrlLookupResult): Promise<ExternalExtractorResult> {
        const response = await this.requestWithRetries(file, book, account, lookup);
        return {
            transactions: this.mapToExtractedTransactions(response),
        };
    }

    /**
     * Extract one transaction using external service.
     * The transaction operation requires data.transaction.
     */
    async extractTransaction(file: File, book: Book, account: Account, lookup: ExtractorUrlLookupResult): Promise<ExtractedTransaction> {
        const response = await this.requestWithRetries(file, book, account, lookup);
        if (!response.data?.transaction) {
            throw new Error('External transaction parser response missing data.transaction');
        }
        return this.mapToExtractedTransaction(response.data.transaction);
    }

    /**
     * Extract file metadata properties using external service.
     * The file operation consumes only file.properties.
     */
    async extractFileProperties(file: File, book: Book, account: Account | undefined, lookup: ExtractorUrlLookupResult): Promise<Record<string, string> | undefined> {
        const response = await this.requestWithRetries(file, book, account, lookup);
        return this.coerceStringProperties(response.file?.properties);
    }

    private async requestWithRetries(file: File, book: Book, account: Account | undefined, lookup: ExtractorUrlLookupResult): Promise<ExternalExtractorResponse> {
        const request = await this.buildRequest(file, book, account, lookup);

        for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    const delay = this.calculateBackoffDelay(attempt);
                    console.log(`Retrying external extractor ${this.url} (attempt ${attempt + 1}/${this.MAX_RETRIES + 1}) after ${delay}ms...`);
                    await this.sleep(delay);
                }

                return await this.callExternalService(request);
            } catch (error) {
                // Fail deterministic parser errors immediately.
                if (error instanceof NonRetryableError) {
                    throw error;
                }

                console.warn(`External extractor attempt ${attempt + 1} failed:`, error);

                if (attempt === this.MAX_RETRIES) {
                    throw new Error(`External extractor failed after ${this.MAX_RETRIES + 1} attempts: ${error}`);
                }
            }
        }

        throw new Error('External extractor failed unexpectedly');
    }

    /**
     * Build the request payload for the external service.
     */
    private async buildRequest(file: File, book: Book, account: Account | undefined, lookup: ExtractorUrlLookupResult): Promise<ExternalExtractorRequest> {
        const fileContent = await file.getContent();
        if (!fileContent) {
            throw new Error('File content is empty');
        }

        // Populate accounts for the main book based on where the extractor URL was found.
        const accounts = await this.buildMainBookAccounts(book, account, lookup);

        // Include the matched group when the parser URL was configured on a group.
        const group = lookup.source === 'group' ? this.buildGroupContext(lookup.group) : undefined;

        const request: ExternalExtractorRequest = {
            book: {
                ...book.json(),
                accounts,
            },
            file: {
                id: file.getId() || '',
                name: file.getName() || '',
                content: fileContent, // Already base64 from file.getContent()
                contentType: file.getContentType() || '',
            },
        };

        if (account) {
            request.account = {
                id: account.getId() || '',
                name: account.getName() || '',
                properties: this.filterVisibleProperties(account.getVisibleProperties()),
            };
        }

        if (group) {
            request.group = group;
        }

        return request;
    }

    /**
     * Build the accounts array for the main book based on the extractor URL lookup source.
     *
     * - source 'account': only the matched account itself
     * - source 'group':   all non-archived accounts in the matched group
     * - source 'book':    all non-archived accounts in the book
     */
    private async buildMainBookAccounts(book: Book, account: Account | undefined, lookup: ExtractorUrlLookupResult): Promise<bkper.Account[]> {
        if (lookup.source === 'account') {
            if (!account) {
                throw new Error('Account is required for account-scoped external parser');
            }
            return [account.json()];
        }

        if (lookup.source === 'group') {
            if (!lookup.group) {
                throw new Error('Group is required for group-scoped external parser');
            }
            const groupAccounts = await lookup.group.getAccounts();
            return groupAccounts.filter((a) => !a.isArchived()).map((a) => a.json());
        }

        // source === 'book'
        const bookAccounts = await book.getAccounts();
        return bookAccounts.filter((a) => !a.isArchived()).map((a) => a.json());
    }

    /**
     * Make HTTP POST request to external service.
     */
    private async callExternalService(request: ExternalExtractorRequest): Promise<ExternalExtractorResponse> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

        try {
            console.log(`Calling external extractor: ${this.url}`);

            // Measure external extractor response time.
            const startedAt = Date.now();
            const response = await fetch(this.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(request),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            const data = (await response.json()) as ExternalExtractorResponse;
            const elapsedMs = Date.now() - startedAt;
            console.log(`External extractor answered in ${elapsedMs}ms (status ${response.status})`);

            if (!response.ok) {
                const errorMsg = data.error?.message || `HTTP ${response.status}`;
                const errorCode = data.error?.code || 'EXTERNAL_SERVICE_ERROR';

                // Treat client-side parser errors as deterministic, except rate limits.
                if (response.status >= 400 && response.status < 500 && response.status !== 429) {
                    throw new NonRetryableError(`External service client error [${errorCode}]: ${errorMsg}`);
                }

                throw new Error(`External service error [${errorCode}]: ${errorMsg}`);
            }

            if (!data.success) {
                const errorMsg = data.error?.message || 'Unknown error';
                const errorCode = data.error?.code || 'EXTERNAL_SERVICE_ERROR';
                throw new NonRetryableError(`External service returned error [${errorCode}]: ${errorMsg}`);
            }

            return data;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error(`External service timeout after ${this.TIMEOUT_MS}ms`);
            }
            throw error;
        }
    }

    /**
     * Map external transaction format to internal ExtractedTransaction format.
     */
    private mapToExtractedTransactions(response: ExternalExtractorResponse): ExtractedTransaction[] {
        if (!response.data?.transactions || response.data.transactions.length === 0) {
            console.warn('External extractor returned no transactions');
            return [];
        }

        return response.data.transactions.map((tx) => this.mapToExtractedTransaction(tx));
    }

    private mapToExtractedTransaction(tx: ExtractedTransaction): ExtractedTransaction {
        const mapped: ExtractedTransaction = {
            date: tx.date,
            description: tx.description,
            amount: tx.amount,
            properties: tx.properties || {},
        };

        // Preserve optional override fields if present.
        if (tx.book_id) {
            mapped.book_id = tx.book_id;
        }
        if (tx.account_name) {
            mapped.account_name = tx.account_name;
        }

        return mapped;
    }

    private coerceStringProperties(properties: Record<string, string> | undefined): Record<string, string> | undefined {
        if (!properties) {
            return undefined;
        }
        return Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, String(value)]));
    }

    private buildGroupContext(group: Group | undefined): bkper.Group | undefined {
        if (!group) {
            return undefined;
        }

        // Preserve canonical group fields while hiding internal agent configuration.
        return {
            ...group.json(),
            properties: this.filterVisibleProperties(group.getVisibleProperties()),
        };
    }

    /**
     * Calculate exponential backoff delay.
     */
    private calculateBackoffDelay(attempt: number): number {
        return this.INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
    }

    /**
     * Filter visible properties to exclude agent-specific keys.
     * Excludes properties starting with 'agent_' to avoid sending
     * internal system properties to external parsers.
     */
    private filterVisibleProperties(properties: Record<string, string>): Record<string, string> {
        const filtered: Record<string, string> = {};

        for (const [key, value] of Object.entries(properties)) {
            if (!key.startsWith('agent_')) {
                filtered[key] = value;
            }
        }

        return filtered;
    }

    /**
     * Sleep utility for retry delays.
     */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
