import { afterEach, describe, expect, test } from 'bun:test';
import { Amount, Bkper, Book } from 'bkper-js';

interface FetchCall {
    url: string;
    method: string | undefined;
}

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;

afterEach(() => {
    Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: originalFetch,
    });
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
});

function getRequestUrl(input: string | URL | Request): string {
    if (typeof input === 'string') {
        return input;
    }
    if (input instanceof URL) {
        return input.toString();
    }
    return input.url;
}

function interceptFetch(status: number, body: object): FetchCall[] {
    const calls: FetchCall[] = [];
    const fetchMock = async (
        input: string | URL | Request,
        init?: RequestInit
    ): Promise<Response> => {
        calls.push({ url: getRequestUrl(input), method: init?.method });
        return new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
        });
    };
    Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: fetchMock,
    });
    return calls;
}

function createBook(bkper = new Bkper(), overrides: Partial<bkper.Book> = {}): Book {
    return new Book(
        {
            id: 'book-1',
            name: 'Tax Book',
            decimalSeparator: 'DOT',
            fractionDigits: 2,
            ...overrides,
        },
        bkper.getConfig()
    );
}

describe('bkper-js 2.19 tax compatibility', () => {
    test('preserves Amount arithmetic, comparison, absolute value, and rounding', () => {
        const amount = new Amount('-12.345');

        expect(amount.abs().toString()).toBe('12.345');
        expect(amount.plus('2.345').toString()).toBe('-10');
        expect(amount.minus('0.655').toString()).toBe('-13');
        expect(amount.times('-2').toString()).toBe('24.69');
        expect(amount.div('-3').toString()).toBe('4.115');
        expect(amount.cmp('-12.345')).toBe(0);
        expect(amount.lt(0)).toBe(true);
        expect(amount.abs().round(2).toString()).toBe('12.35');
    });

    test('preserves Book decimal parsing and fraction-digit rounding', () => {
        const dotBook = createBook();
        const commaBook = createBook(new Bkper(), { decimalSeparator: 'COMMA' });

        expect(dotBook.parseValue('12.50')?.toString()).toBe('12.5');
        expect(commaBook.parseValue('12,50')?.toString()).toBe('12.5');
        expect(dotBook.round(new Amount('1.235')).toString()).toBe('1.24');
    });

    test('uses the platform API endpoint and preserves nullable missing Account lookup', async () => {
        console.warn = () => undefined;
        const calls = interceptFetch(404, { error: { message: 'not found' } });

        const account = await createBook().getAccount('missing-account');

        expect(account).toBeUndefined();
        expect(calls).toEqual([
            {
                url: 'https://api.bkper.app/v5/books/book-1/accounts/missing-account?',
                method: 'GET',
            },
        ]);
    });

    test('keeps non-404 API failures observable', async () => {
        console.log = () => undefined;
        const bkper = new Bkper({
            apiBaseUrl: 'https://api.test',
            oauthTokenProvider: async () => 'test-token',
        });
        const calls = interceptFetch(400, { error: { message: 'invalid account lookup' } });
        let caught: unknown;

        try {
            await createBook(bkper).getAccount('invalid-account');
        } catch (error: unknown) {
            caught = error;
        }

        expect(caught).toBe('invalid account lookup');
        expect(calls).toEqual([
            {
                url: 'https://api.test/v5/books/book-1/accounts/invalid-account?',
                method: 'GET',
            },
        ]);
    });
});
