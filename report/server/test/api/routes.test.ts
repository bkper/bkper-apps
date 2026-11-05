import { describe, expect, it } from 'vitest';
import { Bkper, BkperError } from 'bkper-js';
import { HTTPException } from 'hono/http-exception';
import { AppContext, type AppContextFactory } from '../../src/app-context';
import app, { createApp } from '../../src/index';
import { createTestEnv } from '../test-env';

function failingContext(error: unknown): AppContextFactory {
    return () => {
        throw error;
    };
}

describe('app API routes', () => {
    it('returns a lightweight API ping without calling Bkper', async () => {
        const response = await app.request('/api/v1/ping');
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body).toEqual({ ok: true, source: 'report' });
    });

    it('creates request context through middleware for app API routes', async () => {
        let contextCreations = 0;
        const testApp = createApp(c => {
            contextCreations += 1;
            return new AppContext(new Bkper(), c.env);
        });

        const response = await testApp.request('/api/v1/ping');

        expect(response.status).toBe(200);
        expect(contextCreations).toBe(1);
    });

    it('forwards HTTP errors raised while serving the API', async () => {
        const testApp = createApp(
            failingContext(new HTTPException(403, { message: 'Required Book permission' }))
        );

        const response = await testApp.request('/api/v1/ping');

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({
            success: false,
            error: { code: '403', message: 'Required Book permission' },
        });
    });

    it('forwards controlled Bkper API errors without individual status mapping', async () => {
        const testApp = createApp(
            failingContext(new BkperError(401, 'You are not a collaborator on this Book'))
        );

        const response = await testApp.request('/api/v1/ping');

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({
            success: false,
            error: { code: '401', message: 'You are not a collaborator on this Book' },
        });
    });

    it('hides unexpected server API failure details', async () => {
        const testApp = createApp(failingContext(new Error('Sensitive internal details')));
        const originalConsoleError = console.error;
        console.error = () => undefined;

        try {
            const response = await testApp.request('/api/v1/ping');

            expect(response.status).toBe(500);
            expect(await response.json()).toEqual({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
            });
        } finally {
            console.error = originalConsoleError;
        }
    });

    it('does not handle Bkper events, because the app never changes a Book', async () => {
        const response = await app.request(
            '/events',
            { method: 'POST', body: JSON.stringify({ type: 'TRANSACTION_CHECKED' }) },
            createTestEnv()
        );

        expect(response.status).toBe(404);
    });

    it('returns JSON 404 for unknown API routes instead of serving client assets', async () => {
        const response = await app.request('/api/missing', {}, createTestEnv());

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Route not found: GET /api/missing' },
        });
    });

    it('does not expose unversioned public API routes', async () => {
        const response = await app.request('/api/books', {}, createTestEnv());

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Route not found: GET /api/books' },
        });
    });
});
