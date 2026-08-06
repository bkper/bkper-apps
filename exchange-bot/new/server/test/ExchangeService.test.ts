import { afterEach, describe, expect, test } from 'bun:test';
import { Amount, Bkper } from 'bkper-js';
import { AppContext } from '../src/shared/app-context.js';
import { ExchangeService } from '../src/ExchangeService.js';
import type { ExchangeRates } from '../src/ExchangeRates.js';

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalDateNow = Date.now;
let urlSequence = 0;

afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    Date.now = originalDateNow;
});

function createService(): ExchangeService {
    return new ExchangeService(
        new AppContext(new Bkper(), {
            OPEN_EXCHANGE_RATES_APP_ID: 'test-only',
            ASSETS: { fetch },
        })
    );
}

function createRates(base: string, rates: Record<string, string>): ExchangeRates {
    return { base, rates, status: 200 };
}

function uniqueUrl(): string {
    urlSequence += 1;
    return `https://rates.test/${urlSequence}`;
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function replaceFetch(
    handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
): void {
    globalThis.fetch = handler as typeof fetch;
}

function makeTimersImmediate(): number[] {
    const delays: number[] = [];
    globalThis.setTimeout = ((handler: TimerHandler, timeout?: number) => {
        delays.push(timeout ?? 0);
        if (typeof handler === 'function') {
            handler();
        }
        return 0;
    }) as typeof setTimeout;
    return delays;
}

async function getRejection(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error: unknown) {
        return error;
    }
    throw new Error('Expected promise to reject');
}

describe('legacy event exchange service', () => {
    test('returns and mutates the same rates when the base already matches', () => {
        const rates = createRates('USD', { EUR: '0.85' });

        const result = createService().convertBase(rates, 'USD');

        expect(result).toBe(rates);
        expect(result?.rates.USD).toBe('1');
    });

    test('converts all rates to a new base', () => {
        const rates = createRates('USD', { EUR: '0.5', GBP: '0.25' });

        const result = createService().convertBase(rates, 'EUR');

        expect(result?.base).toBe('EUR');
        expect(result?.rates.USD).toBe('2');
        expect(result?.rates.GBP).toBe('0.5');
    });

    test('returns null when the requested base is unavailable', () => {
        const rates = createRates('USD', { EUR: '0.85' });

        expect(createService().convertBase(rates, 'XXX')).toBeNull();
    });

    test('converts an amount directly and after changing the rates base', async () => {
        const direct = await createService().convert(
            new Amount('100'),
            'USD',
            'BRL',
            createRates('USD', { EUR: '0.5', BRL: '5' })
        );
        const rebased = await createService().convert(
            new Amount('100'),
            'EUR',
            'BRL',
            createRates('USD', { EUR: '0.5', BRL: '5' })
        );

        expect(direct.base).toBe('USD');
        expect(direct.rate.toString()).toBe('5');
        expect(direct.amount?.toString()).toBe('500');
        expect(rebased.base).toBe('EUR');
        expect(rebased.amount?.toString()).toBe('1000');
    });

    test('preserves missing-code and provider-error failures', async () => {
        const service = createService();
        const rates = createRates('USD', { EUR: '0.85' });
        const providerError: ExchangeRates = {
            base: 'USD',
            rates: {},
            status: 400,
            error: true,
            description: 'Invalid request',
        };

        expect(service.convert(new Amount('100'), 'XXX', 'EUR', rates)).rejects.toThrow();
        expect(service.convert(new Amount('100'), 'USD', 'XXX', rates)).rejects.toThrow();
        expect(service.convert(new Amount('100'), 'USD', 'EUR', providerError)).rejects.toThrow(
            'Invalid request'
        );
    });

    test('caches cloned rates for 30 minutes per endpoint', async () => {
        const service = createService();
        const url = uniqueUrl();
        let requests = 0;
        let requestInit: RequestInit | undefined;
        let now = 1_000;
        Date.now = () => now;
        replaceFetch(async (_input, init) => {
            requests += 1;
            requestInit = init;
            return jsonResponse(createRates('USD', { BRL: '5' }));
        });

        const first = await service.getRates(url);
        first.base = 'MUTATED';
        first.rates.BRL = '9';
        const cached = await service.getRates(url);
        now += 1_800_001;
        const expired = await service.getRates(url);

        expect(cached.base).toBe('USD');
        expect(cached.rates.BRL).toBe('5');
        expect(expired.base).toBe('USD');
        expect(requests).toBe(2);
        expect(requestInit).toEqual({
            method: 'GET',
            headers: { Accept: 'application/json' },
        });
    });

    test('retries configured HTTP statuses five times with legacy delays', async () => {
        const service = createService();
        const url = uniqueUrl();
        const delays = makeTimersImmediate();
        let requests = 0;
        replaceFetch(async () => {
            requests += 1;
            return jsonResponse({ description: 'Unavailable' }, requests === 1 ? 401 : 500);
        });

        const error = await getRejection(service.getRates(url));

        expect(requests).toBe(6);
        expect(delays).toEqual([100, 500, 1500, 3500, 7500]);
        expect(error).toEqual({ description: 'Unavailable' });
    });

    test('retries network failures only twice', async () => {
        const service = createService();
        const delays = makeTimersImmediate();
        let requests = 0;
        replaceFetch(async () => {
            requests += 1;
            throw new Error('network failed');
        });

        const error = await getRejection(service.getRates(uniqueUrl()));

        expect(requests).toBe(3);
        expect(delays).toEqual([100, 500]);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('network failed');
    });

    test('shares the legacy retry counter between responses and network failures', async () => {
        const service = createService();
        const delays = makeTimersImmediate();
        let requests = 0;
        replaceFetch(async () => {
            requests += 1;
            if (requests === 1) {
                return jsonResponse({ description: 'Unavailable' }, 500);
            }
            throw new Error('network failed');
        });

        await getRejection(service.getRates(uniqueUrl()));

        expect(requests).toBe(3);
        expect(delays).toEqual([100, 500]);
    });

    test('retries response body failures as legacy no-response failures', async () => {
        const service = createService();
        const delays = makeTimersImmediate();
        let requests = 0;
        replaceFetch(async () => {
            requests += 1;
            return new Response(
                new ReadableStream({
                    start(controller) {
                        controller.error(new Error('body failed'));
                    },
                })
            );
        });

        const error = await getRejection(service.getRates(uniqueUrl()));

        expect(requests).toBe(3);
        expect(delays).toEqual([100, 500]);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('body failed');
    });

    test('preserves legacy handling of empty and falsy response bodies', async () => {
        const service = createService();
        const emptyErrorUrl = uniqueUrl();
        const falseErrorUrl = uniqueUrl();
        const emptySuccessUrl = uniqueUrl();
        replaceFetch(async input => {
            const url = input.toString();
            if (url === emptyErrorUrl) {
                return new Response('', { status: 400 });
            }
            if (url === falseErrorUrl) {
                return jsonResponse(false, 400);
            }
            return new Response('', { status: 200 });
        });

        const emptyError = await getRejection(service.getRates(emptyErrorUrl));
        const falseError = await getRejection(service.getRates(falseErrorUrl));
        const emptySuccess = await getRejection(service.getRates(emptySuccessUrl));

        expect(emptyError).toBeInstanceOf(Error);
        expect((emptyError as Error).name).toBe('GaxiosError');
        expect((emptyError as Error).message).toBe('Request failed with status code 400');
        expect(falseError).toBeInstanceOf(Error);
        expect((falseError as Error).message).toBe('Request failed with status code 400');
        expect(String(emptySuccess)).toContain('wrong format');
    });

    test('rejects non-retryable responses and malformed successful payloads', async () => {
        const service = createService();
        const nonRetryableUrl = uniqueUrl();
        const malformedUrl = uniqueUrl();
        replaceFetch(async input => {
            const url = input.toString();
            if (url === nonRetryableUrl) {
                return jsonResponse({ message: 'Bad request' }, 400);
            }
            return jsonResponse({ status: 200 });
        });

        expect(await getRejection(service.getRates(nonRetryableUrl))).toEqual({
            message: 'Bad request',
        });
        expect(String(await getRejection(service.getRates(malformedUrl)))).toContain('Expected:');
    });
});
