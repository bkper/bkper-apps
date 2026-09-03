import { describe, expect, it } from 'bun:test';
import { createApp } from '../../src/index.js';

interface OpenApiOperation {
    requestBody?: {
        content?: Record<string, { schema?: unknown }>;
    };
    responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
}

interface OpenApiDocument {
    info: { title: string; version: string };
    paths: Record<string, Record<string, OpenApiOperation>>;
    components?: { schemas?: Record<string, unknown> };
}

describe('Inventory Bot OpenAPI contract', () => {
    it('documents exactly the two public operations', async () => {
        const response = await createApp().request('/openapi.json');
        const spec = (await response.json()) as OpenApiDocument;

        expect(response.status).toBe(200);
        expect(spec.info).toEqual({ title: 'Inventory Bot API', version: '1.0.0' });
        expect(Object.keys(spec.paths).sort()).toEqual([
            '/api/v1/books/{bookId}/accounts/{accountId}/calculate',
            '/api/v1/books/{bookId}/accounts/{accountId}/reset',
        ]);
        expect(
            Object.keys(spec.paths['/api/v1/books/{bookId}/accounts/{accountId}/calculate'])
        ).toEqual(['post']);
        expect(
            Object.keys(spec.paths['/api/v1/books/{bookId}/accounts/{accountId}/reset'])
        ).toEqual(['post']);
        expect(spec.paths['/events']).toBeUndefined();
        expect(spec.paths['/health']).toBeUndefined();
    });

    it('documents Calculate input, shared success messages, and errors', async () => {
        const response = await createApp().request('/openapi.json');
        const spec = (await response.json()) as OpenApiDocument;
        const schemas = spec.components?.schemas ?? {};
        const calculate = spec.paths['/api/v1/books/{bookId}/accounts/{accountId}/calculate'].post;
        const reset = spec.paths['/api/v1/books/{bookId}/accounts/{accountId}/reset'].post;

        expect(calculate.requestBody?.content?.['application/json'].schema).toEqual({
            $ref: '#/components/schemas/CalculateRequest',
        });
        expect(reset.requestBody).toBeUndefined();
        expect(schemas.CalculateRequest).toEqual({
            type: 'object',
            properties: {
                date: { type: 'string', format: 'date' },
            },
            required: ['date'],
        });
        expect(schemas.OperationResponse).toEqual({
            type: 'object',
            properties: {
                message: { type: 'string' },
            },
            required: ['message'],
        });
        for (const operation of [calculate, reset]) {
            expect(operation.responses?.['200'].content?.['application/json'].schema).toEqual({
                $ref: '#/components/schemas/OperationResponse',
            });
            expect(operation.responses?.['204']).toBeUndefined();
            expect(operation.responses?.['403']).toBeDefined();
            expect(operation.responses?.['404']).toBeUndefined();
            expect(operation.responses?.['409']).toBeUndefined();
        }
        expect(schemas.ApiError).toBeDefined();
        expect(schemas.CalculateResult).toBeUndefined();
        expect(schemas.ResetResult).toBeUndefined();
    });
});
