import type { AppContext } from '../../shared/app-context.js';
import type { ExchangeRates } from '../schemas.js';
import { BotService } from './bot-service.js';

export class ExchangeRatesService {
    static async load(context: AppContext, bookId: string, date: string): Promise<ExchangeRates> {
        const book = await context.bkper.getBook(bookId);
        const botService = new BotService(context);
        const ratesEndpointConfig = botService.getRatesEndpointConfig(book, date, 'app');

        const response = await fetch(ratesEndpointConfig.url);
        if (!response.ok) {
            throw new Error(`Request failed with status code ${response.status}`);
        }

        const exchangeRates = (await response.json()) as ExchangeRates;

        const connectedBooks = await botService.getConnectedBooks(book);
        connectedBooks.add(book);
        const codes = Array.from(connectedBooks, connectedBook =>
            botService.getBaseCode(connectedBook)
        );

        for (const rate in exchangeRates.rates) {
            if (!codes.includes(rate)) {
                delete exchangeRates.rates[rate];
            }
        }

        if (exchangeRates.rates[exchangeRates.base]) {
            delete exchangeRates.rates[exchangeRates.base];
        }

        exchangeRates.date = date;

        return exchangeRates;
    }
}
