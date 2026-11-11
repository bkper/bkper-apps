import { afterEach, describe, expect, it, mock } from 'bun:test';
import { Bkper, Book, Permission } from 'bkper-js';
import app from '../../src/index.js';
import { ParseRequestSchema } from '../../src/api/schemas.js';
import type { components } from '../../src/api/generated/types.js';

const originalGetBook = Bkper.prototype.getBook;
afterEach(() => { Bkper.prototype.getBook = originalGetBook; });

describe('parse boundary', () => {
    it('rejects malformed and incomplete requests before any Book access', async () => {
        const getBook = mock(async () => { throw new Error('Invalid requests must not read Books'); });
        Bkper.prototype.getBook = getBook;
        for (const body of ['{', '{}', JSON.stringify({ bookId: 'book_1' }), JSON.stringify({ bookId: 'book_1', file: {} }), JSON.stringify({ bookId: 'book_1', transaction: { amount: 12 } })]) {
            const response = await app.request('/api/v1/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, {} as Env);
            expect(response.status).toBe(400);
            expect(await response.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
        }
        expect(getBook).not.toHaveBeenCalled();
    });

    it('accepts canonical file or transaction inputs and validates consumed fields', () => {
        const input: components['schemas']['ParseRequest'] = { bookId: 'book_1', file: { id: 'file_1', properties: { account_id: 'account_1' } } };
        expect(ParseRequestSchema.safeParse(input).success).toBe(true);
        expect(ParseRequestSchema.safeParse({ bookId: 'book_1', transaction: { description: 'Payment', date: '2024-02-30' } }).success).toBe(false);
        expect(ParseRequestSchema.safeParse({ bookId: 'book_1', file: { content: 'not base64!' } }).success).toBe(false);
        expect(ParseRequestSchema.safeParse({ bookId: 'book_1', transaction: { creditAccount: { name: 'Bank' } } }).success).toBe(false);
    });

    it('serves the public contract and handles a read-authorized parse without installation', async () => {
        const book = new Book({ id: 'book_1', permission: Permission.VIEWER });
        book.getApps = mock(async () => { throw new Error('No installation requirement'); });
        Bkper.prototype.getBook = mock(async () => book);
        const response = await app.request('/api/v1/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookId: 'book_1', transaction: { amount: '10', date: '2024-01-01', description: 'Complete' } }) }, {} as Env);
        expect(response.status).toBe(200);
        const result: unknown = await response.json();
        expect(result).toEqual({ transactions: [], outcome: 'empty' });
        expect(book.getApps).not.toHaveBeenCalled();
        const spec = await app.request('/openapi.json');
        expect(spec.status).toBe(200);
        expect(await spec.json()).toMatchObject({ paths: { '/api/v1/parse': { post: { operationId: 'parse' } } }, security: [{ bearerAuth: [] }] });
        expect((await app.request('/api/v1/parse/batch', { method: 'POST' })).status).toBe(404);
    });
});
