import { describe, expect, it } from 'bun:test';
import { createApp } from '../../src/index.js';

interface OpenApiOperation {
    requestBody?: {
        content?: Record<string, { schema?: unknown }>;
    };
    responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
}

interface OpenApiDocument {
    paths: Record<string, Record<string, OpenApiOperation>>;
    components?: { schemas?: Record<string, unknown> };
}

describe('Portfolio Bot OpenAPI contract', () => {
    it('documents exactly the five public operations', async () => {
        const response = await createApp().request('/openapi.json');
        const spec = (await response.json()) as OpenApiDocument;

        expect(response.status).toBe(200);
        expect(Object.keys(spec.paths).sort()).toEqual([
            '/api/v1/books/{bookId}/accounts/pending-calculation',
            '/api/v1/books/{bookId}/accounts/{accountId}/calculate',
            '/api/v1/books/{bookId}/accounts/{accountId}/forward',
            '/api/v1/books/{bookId}/accounts/{accountId}/full-reset',
            '/api/v1/books/{bookId}/accounts/{accountId}/reset',
        ]);
        expect(
            Object.keys(spec.paths['/api/v1/books/{bookId}/accounts/pending-calculation'])
        ).toEqual(['get']);
        expect(
            Object.keys(spec.paths['/api/v1/books/{bookId}/accounts/{accountId}/calculate'])
        ).toEqual(['post']);
        expect(spec.paths['/events']).toBeUndefined();
        expect(spec.paths['/health']).toBeUndefined();
    });

    it('documents operation inputs, no-content success, and errors', async () => {
        const response = await createApp().request('/openapi.json');
        const spec = (await response.json()) as OpenApiDocument;
        const schemas = spec.components?.schemas ?? {};
        const pending = spec.paths['/api/v1/books/{bookId}/accounts/pending-calculation'].get;
        const calculate = spec.paths['/api/v1/books/{bookId}/accounts/{accountId}/calculate'].post;
        const reset = spec.paths['/api/v1/books/{bookId}/accounts/{accountId}/reset'].post;
        const fullReset = spec.paths['/api/v1/books/{bookId}/accounts/{accountId}/full-reset'].post;
        const forward = spec.paths['/api/v1/books/{bookId}/accounts/{accountId}/forward'].post;

        expect(pending.responses?.['200'].content?.['application/json'].schema).toEqual({
            $ref: '#/components/schemas/PendingCalculationAccounts',
        });
        expect(schemas.PendingCalculationAccounts).toEqual({
            type: 'object',
            properties: {
                ids: {
                    type: 'array',
                    items: { type: 'string', minLength: 1 },
                },
            },
            required: ['ids'],
        });
        expect(calculate.requestBody?.content?.['application/json'].schema).toEqual({
            $ref: '#/components/schemas/CalculateRequest',
        });
        expect(forward.requestBody?.content?.['application/json'].schema).toEqual({
            $ref: '#/components/schemas/ForwardRequest',
        });
        for (const operation of [calculate, reset, fullReset, forward]) {
            expect(operation.responses?.['200']).toBeUndefined();
            expect(operation.responses?.['204']).toBeDefined();
            expect(operation.responses?.['204'].content).toBeUndefined();
        }
        expect(calculate.responses?.['403']).toBeDefined();
        expect(calculate.responses?.['404']).toBeUndefined();
        expect(calculate.responses?.['409']).toBeUndefined();
        expect(pending.responses?.['404']).toBeUndefined();
        expect(pending.responses?.['409']).toBeUndefined();
        expect(schemas.ApiError).toBeDefined();
        expect(schemas.CalculateResult).toBeUndefined();
        expect(schemas.ResetResult).toBeUndefined();
        expect(schemas.FullResetResult).toBeUndefined();
        expect(schemas.ForwardResult).toBeUndefined();
    });
});
