import { Amount } from 'bkper-js';
import type { AppContext } from './app-context.js';
import type { ExchangeRates } from './ExchangeRates.js';

const CACHE_TTL_MS = 1_800_000;

interface RatesCacheEntry {
    expiresAt: number;
    rates: ExchangeRates;
}

const ratesCache = new Map<string, RatesCacheEntry>();

export interface ConvertedAmount {
    amount?: Amount;
    base: string;
    rate: Amount;
}

export class ExchangeService {
    private context: AppContext;

    constructor(context: AppContext) {
        this.context = context;
    }

    async convert(
        value: Amount,
        from: string,
        to: string,
        rates: ExchangeRates
    ): Promise<ConvertedAmount> {
        if (rates.error) {
            throw rates.description || rates.message || 'Error reading rates';
        }

        const convertedRates = this.convertBase(rates, from);
        if (convertedRates == null) {
            throw `Code ${from} not found in ${JSON.stringify(rates)}`;
        }

        const rate = convertedRates.rates[to];
        if (rate == null) {
            throw `Code ${to} not found in ${JSON.stringify(rates)}`;
        }

        return {
            base: convertedRates.base,
            rate: new Amount(rate),
            amount: new Amount(rate).times(value),
        };
    }

    convertBase(rates: ExchangeRates, toBase: string): ExchangeRates | null {
        rates.rates[rates.base] = '1';
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
            try {
                rates.rates[key] = new Amount(value).times(newRate).toString();
            } catch (_error: unknown) {
                // ok
            }
        }
        return rates;
    }

    async getRates(ratesEndpointUrl: string): Promise<ExchangeRates> {
        const cacheKey = `3_${ratesEndpointUrl}`;
        const random = Math.random();
        const timeLabel = `getRates ${random}`;
        console.time(timeLabel);

        const cachedRates = getCachedRates(cacheKey);
        if (cachedRates != null) {
            console.timeEnd(timeLabel);
            return cachedRates;
        }

        console.warn('Fetching rates...');
        const rates = await fetchRates(ratesEndpointUrl);

        if (rates == null) {
            throw `Unable to get exchange rates from endpoint ${ratesEndpointUrl}`;
        }

        if (!rates.error && (rates.base == null || rates.rates == null)) {
            throw `Rates json from ${ratesEndpointUrl} in wrong format. Expected:
        {
          base: string;
          date: string;
          rates: {
            [key: string]: number;
          }
        }
        `;
        }

        setCachedRates(cacheKey, rates);
        console.timeEnd(timeLabel);
        return rates;
    }
}

function getCachedRates(cacheKey: string): ExchangeRates | undefined {
    const now = Date.now();
    for (const [key, entry] of ratesCache) {
        if (entry.expiresAt < now) {
            ratesCache.delete(key);
        }
    }
    const entry = ratesCache.get(cacheKey);
    return entry ? structuredClone(entry.rates) : undefined;
}

function setCachedRates(cacheKey: string, rates: ExchangeRates): void {
    ratesCache.set(cacheKey, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        rates: structuredClone(rates),
    });
}

async function fetchRates(ratesEndpointUrl: string): Promise<ExchangeRates> {
    let retryAttempt = 0;

    while (true) {
        let response: Response;
        let data: unknown;
        try {
            response = await fetch(ratesEndpointUrl, {
                method: 'GET',
                headers: { Accept: 'application/json' },
            });
            data = await readResponseData(response);
        } catch (error: unknown) {
            if (retryAttempt >= 2) {
                throw error;
            }
            await retry(error, retryAttempt);
            retryAttempt += 1;
            continue;
        }

        if (response.ok) {
            return data as ExchangeRates;
        }

        if (isRetryableStatus(response.status) && retryAttempt < 5) {
            await retry(data, retryAttempt);
            retryAttempt += 1;
            continue;
        }

        const responseError = new Error(`Request failed with status code ${response.status}`);
        responseError.name = 'GaxiosError';
        throw data || responseError;
    }
}

function isRetryableStatus(status: number): boolean {
    return (
        (status >= 100 && status <= 199) ||
        (status >= 401 && status <= 429) ||
        (status >= 500 && status <= 599)
    );
}

async function retry(error: unknown, attempt: number): Promise<void> {
    console.log(`${getErrorDescription(error)} - Retrying... `);
    const delay = attempt === 0 ? 100 : ((2 ** attempt - 1) / 2) * 1000;
    await new Promise(resolve => setTimeout(resolve, delay));
}

function getErrorDescription(error: unknown): unknown {
    if (typeof error === 'object' && error !== null && 'description' in error) {
        return error.description;
    }
    return undefined;
}

async function readResponseData(response: Response): Promise<unknown> {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch (_error: unknown) {
        return text;
    }
}
