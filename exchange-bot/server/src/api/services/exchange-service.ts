import { Amount } from 'bkper-js';
import type { ExchangeRates } from '../schemas.js';

export interface ConvertedAmount {
    amount: Amount;
    rate: Amount;
}

export class ExchangeService {
    static convert(value: Amount, from: string, to: string, rates: ExchangeRates): ConvertedAmount {
        const convertedRates = this.convertBase(rates, from);
        if (convertedRates == null) {
            throw `Code ${from} not found in rates`;
        }

        const rate = convertedRates.rates[to];
        if (rate == null) {
            throw `Code ${to} not found in ${JSON.stringify(convertedRates)}`;
        }

        const amountRate = new Amount(rate);
        return {
            rate: amountRate,
            amount: amountRate.times(value),
        };
    }

    private static convertBase(rates: ExchangeRates, toBase: string): ExchangeRates | null {
        rates.rates[rates.base] = 1;
        if (rates.base == toBase) {
            return rates;
        }
        const rate = rates.rates[toBase];
        if (rate == null) {
            return null;
        }

        const newRate = new Amount('1').div(rate);
        rates.base = toBase;
        for (const [key, value] of Object.entries(rates.rates)) {
            rates.rates[key] = new Amount(value).times(newRate).toString();
        }
        return rates;
    }
}
