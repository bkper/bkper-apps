import { describe, expect, it } from 'bun:test';
import { readTrustedAppUrlChange } from '../src/app/app-url-sync';

const parent = {};
const trustedContext = {
    parent,
    appOrigin: 'https://merge-duplicates.bkper.app',
};

function message(overrides: Partial<Pick<MessageEvent, 'source' | 'origin' | 'data'>> = {}) {
    return {
        source: parent,
        origin: 'https://bkper.app',
        data: {
            type: 'bkper:app-url-changed',
            url: 'https://merge-duplicates.bkper.app?bookId=book&query=account%3ABank',
        },
        ...overrides,
    };
}

describe('app URL synchronization', () => {
    it('accepts a same-origin App URL from the trusted Bkper parent', () => {
        const url = readTrustedAppUrlChange(message(), trustedContext);

        expect(url?.searchParams.get('bookId')).toBe('book');
        expect(url?.searchParams.get('query')).toBe('account:Bank');
    });

    it('accepts live updates from the Bkper development host', () => {
        const url = readTrustedAppUrlChange(
            message({ origin: 'https://dev.bkper.app' }),
            trustedContext
        );

        expect(url?.searchParams.get('query')).toBe('account:Bank');
    });

    it('accepts a localhost Bkper parent only when the App also runs locally', () => {
        const localMessage = message({
            origin: 'http://localhost:8080',
            data: {
                type: 'bkper:app-url-changed',
                url: 'http://localhost:8795?bookId=book&query=account%3ABank',
            },
        });

        expect(
            readTrustedAppUrlChange(localMessage, {
                parent,
                appOrigin: 'http://localhost:8795',
            })?.searchParams.get('query')
        ).toBe('account:Bank');
        expect(readTrustedAppUrlChange(localMessage, trustedContext)).toBeUndefined();
    });

    it('rejects messages that do not come from the trusted parent and App origin', () => {
        expect(readTrustedAppUrlChange(message({ source: {} }), trustedContext)).toBeUndefined();
        expect(
            readTrustedAppUrlChange(message({ origin: 'https://attacker.example' }), trustedContext)
        ).toBeUndefined();
        expect(
            readTrustedAppUrlChange(
                message({
                    data: {
                        type: 'bkper:app-url-changed',
                        url: 'https://attacker.example?bookId=other',
                    },
                }),
                trustedContext
            )
        ).toBeUndefined();
    });

    it('rejects malformed App URL messages', () => {
        expect(
            readTrustedAppUrlChange(
                message({ data: { type: 'other', url: 'not a URL' } }),
                trustedContext
            )
        ).toBeUndefined();
        expect(
            readTrustedAppUrlChange(
                message({ data: { type: 'bkper:app-url-changed', url: 'not a URL' } }),
                trustedContext
            )
        ).toBeUndefined();
    });
});
