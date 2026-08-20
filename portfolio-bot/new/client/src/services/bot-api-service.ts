import type { PendingCalculationAccounts } from '../api/generated/types.js';
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
    async listAccountsPendingCalculation(bookId: string): Promise<PendingCalculationAccounts> {
        try {
            const url = `/api/v1/books/${encodeURIComponent(bookId)}/accounts/pending-calculation`;
            return await new BotApiRequest<PendingCalculationAccounts>(url).execute();
        } catch (error: unknown) {
            if (error instanceof HttpError && isApiError(error.data)) {
                throw new BotApiError(error.data.error.message, error.status);
            }
            throw error;
        }
    }
}

export const botApiService = new BotApiService();
