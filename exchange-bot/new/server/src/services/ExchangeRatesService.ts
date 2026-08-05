import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../app-context.js';
import type { ExchangeRates } from '../api/schemas.js';

export class ExchangeRatesService {
    static async load(context: AppContext, bookId: string, date: string): Promise<ExchangeRates> {
        void context;
        void bookId;
        void date;
        throw new HTTPException(501, { message: 'Exchange rate loading is not implemented' });
    }
}
