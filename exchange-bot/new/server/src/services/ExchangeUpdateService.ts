import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../app-context.js';
import type { ExchangeRates } from '../api/schemas.js';

export class ExchangeUpdateService {
    static async update(
        context: AppContext,
        bookId: string,
        exchangeRates: ExchangeRates
    ): Promise<bkper.Transaction[]> {
        void context;
        void bookId;
        void exchangeRates;
        throw new HTTPException(501, { message: 'Exchange update is not implemented' });
    }
}
