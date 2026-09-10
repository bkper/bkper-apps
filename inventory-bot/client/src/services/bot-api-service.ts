import type { CalculateRequest, OperationResponse } from '../api/generated/types.js';
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
     * Calculates cost of goods sold for one Inventory Account.
     *
     * @param bookId - The Inventory Book identifier.
     * @param accountId - The Inventory Account identifier.
     * @param request - The calculation date.
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
     * Resets cost-of-goods-sold state for one Inventory Account.
     *
     * @param bookId - The Inventory Book identifier.
     * @param accountId - The Inventory Account identifier.
     * @returns The operation commentary returned by the server.
     */
    async resetAccount(bookId: string, accountId: string): Promise<OperationResponse> {
        return this.executeAccountOperation(bookId, accountId, 'reset');
    }

    private executeAccountOperation(
        bookId: string,
        accountId: string,
        operation: 'calculate' | 'reset',
        payload?: CalculateRequest
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
