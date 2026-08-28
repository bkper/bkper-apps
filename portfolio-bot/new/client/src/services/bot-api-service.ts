import type {
    CalculateRequest,
    ForwardRequest,
    OperationResponse,
    PendingCalculationAccounts,
} from '../api/generated/types.js';
import { isApiError } from '../errors.js';
import { HttpAPIRequest } from './http-api-request.js';
import { HttpError } from './http-request.js';

class BotApiRequest<ResponseType> extends HttpAPIRequest<ResponseType> {}

export class BotApiError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
    }
}

class BotApiService {
    /**
     * Lists the Portfolio Accounts that have results pending calculation.
     *
     * @param bookId - The Portfolio Book identifier.
     * @returns The ordered identifiers of Accounts pending calculation.
     */
    async listAccountsPendingCalculation(bookId: string): Promise<PendingCalculationAccounts> {
        const url = `/api/v1/books/${encodeURIComponent(bookId)}/accounts/pending-calculation`;
        return this.execute(new BotApiRequest<PendingCalculationAccounts>(url));
    }

    /**
     * Calculates realized results for one Portfolio Account.
     *
     * @param bookId - The Portfolio Book identifier.
     * @param accountId - The Portfolio Account identifier.
     * @param request - The calculation date and MTM intent.
     * @returns The operation commentary returned by the server.
     */
    async calculateAccount(
        bookId: string,
        accountId: string,
        request: CalculateRequest
    ): Promise<OperationResponse> {
        return this.executeAccountOperation(bookId, accountId, 'calculate', request);
    }

    /**
     * Resets realized results for one Portfolio Account.
     *
     * @param bookId - The Portfolio Book identifier.
     * @param accountId - The Portfolio Account identifier.
     * @returns The operation commentary returned by the server.
     */
    async resetAccount(bookId: string, accountId: string): Promise<OperationResponse> {
        return this.executeAccountOperation(bookId, accountId, 'reset');
    }

    /**
     * Fully resets realized and forwarded state for one Portfolio Account.
     *
     * @param bookId - The Portfolio Book identifier.
     * @param accountId - The Portfolio Account identifier.
     * @returns The operation commentary returned by the server.
     */
    async fullResetAccount(bookId: string, accountId: string): Promise<OperationResponse> {
        return this.executeAccountOperation(bookId, accountId, 'full-reset');
    }

    /**
     * Sets the Forward Date for one Portfolio Account.
     *
     * @param bookId - The Portfolio Book identifier.
     * @param accountId - The Portfolio Account identifier.
     * @param request - The requested Forward Date.
     * @returns The operation commentary returned by the server.
     */
    async forwardAccount(
        bookId: string,
        accountId: string,
        request: ForwardRequest
    ): Promise<OperationResponse> {
        return this.executeAccountOperation(bookId, accountId, 'forward', request);
    }

    private executeAccountOperation(
        bookId: string,
        accountId: string,
        operation: 'calculate' | 'reset' | 'full-reset' | 'forward',
        payload?: CalculateRequest | ForwardRequest
    ): Promise<OperationResponse> {
        const url = `/api/v1/books/${encodeURIComponent(bookId)}/accounts/${encodeURIComponent(accountId)}/${operation}`;
        const request = new BotApiRequest<OperationResponse>(url).setMethod('POST');
        if (payload !== undefined) {
            request.setPayload(payload);
        }
        return this.execute(request);
    }

    private async execute<ResponseType>(
        request: BotApiRequest<ResponseType>
    ): Promise<ResponseType> {
        try {
            return await request.execute();
        } catch (error: unknown) {
            if (error instanceof HttpError && isApiError(error.data)) {
                throw new BotApiError(error.data.error.message, error.status);
            }
            throw error;
        }
    }
}

export const botApiService = new BotApiService();
