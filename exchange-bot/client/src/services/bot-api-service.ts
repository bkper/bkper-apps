import type { ExchangeRates, ExchangeUpdateResult } from '../api/generated/types.js';
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
    async loadExchangeRates(bookId: string, date: string): Promise<ExchangeRates> {
        try {
            const url = `/api/v1/books/${encodeURIComponent(bookId)}/exchange-rates`;
            return await new BotApiRequest<ExchangeRates>(url).addParam('date', date).execute();
        } catch (error: unknown) {
            if (error instanceof HttpError && isApiError(error.data)) {
                throw new BotApiError(error.data.error.message, error.status);
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
                throw new BotApiError(error.data.error.message, error.status);
            }
            throw error;
        }
    }
}

export const botApiService = new BotApiService();
