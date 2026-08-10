import type { ApiError, ExchangeRates, ExchangeUpdateResult } from '../api/generated/types.js';
import { HttpAPIRequest } from './http-api-request.js';
import { HttpError } from './http-request.js';

class BotApiRequest<ResponseType> extends HttpAPIRequest<ResponseType> {}

class BotApiService {
    async loadExchangeRates(bookId: string, date: string): Promise<ExchangeRates> {
        try {
            const url = `/api/v1/books/${encodeURIComponent(bookId)}/exchange-rates`;
            return await new BotApiRequest<ExchangeRates>(url).addParam('date', date).execute();
        } catch (error: unknown) {
            if (error instanceof HttpError && isApiError(error.data)) {
                throw new Error(error.data.error.message);
            }
            throw error;
        }
    }

    async performExchangeUpdate(
        bookId: string,
        exchangeRates: ExchangeRates
    ): Promise<ExchangeUpdateResult> {
        try {
            const url = `/api/v1/books/${encodeURIComponent(bookId)}/exchange-update`;
            return await new BotApiRequest<ExchangeUpdateResult>(url)
                .setMethod('POST')
                .setPayload(exchangeRates)
                .execute();
        } catch (error: unknown) {
            if (error instanceof HttpError && isApiError(error.data)) {
                throw new Error(error.data.error.message);
            }
            throw error;
        }
    }
}

function isApiError(payload: unknown): payload is ApiError {
    if (typeof payload !== 'object' || payload === null || !('error' in payload)) {
        return false;
    }
    const error = payload.error;
    return (
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof error.message === 'string'
    );
}

export const botApiService = new BotApiService();
