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

    it('documents operation inputs, results, and errors', async () => {
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
        expect(calculate.requestBody?.content?.['application/json'].schema).toEqual({
            $ref: '#/components/schemas/CalculateRequest',
        });
        expect(forward.requestBody?.content?.['application/json'].schema).toEqual({
            $ref: '#/components/schemas/ForwardRequest',
        });
        expect(calculate.responses?.['200'].content?.['application/json'].schema).toEqual({
            $ref: '#/components/schemas/CalculateResult',
        });
        expect(reset.responses?.['200'].content?.['application/json'].schema).toEqual({
            $ref: '#/components/schemas/ResetResult',
        });
        expect(fullReset.responses?.['200'].content?.['application/json'].schema).toEqual({
            $ref: '#/components/schemas/FullResetResult',
        });
        expect(forward.responses?.['200'].content?.['application/json'].schema).toEqual({
            $ref: '#/components/schemas/ForwardResult',
        });
        expect(calculate.responses?.['204']).toBeUndefined();
        expect(reset.responses?.['204']).toBeUndefined();
        expect(fullReset.responses?.['204']).toBeUndefined();
        expect(forward.responses?.['204']).toBeUndefined();
        expect(calculate.responses?.['403']).toBeDefined();
        expect(calculate.responses?.['404']).toBeUndefined();
        expect(calculate.responses?.['409']).toBeUndefined();
        expect(pending.responses?.['404']).toBeUndefined();
        expect(pending.responses?.['409']).toBeUndefined();
        expect(schemas.ApiError).toBeDefined();
        expect(schemas.CalculateResult).toBeDefined();
        expect(schemas.ResetResult).toBeDefined();
        expect(schemas.FullResetResult).toBeDefined();
        expect(schemas.ForwardResult).toBeDefined();
        expect(schemas.OperationReceipt).toBeUndefined();
    });
});
