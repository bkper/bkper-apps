import { describe, expect, it } from 'bun:test';
import { createApp } from '../../src/index.js';

interface OpenApiOperation {
    responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
}

interface OpenApiDocument {
    paths: Record<string, Record<string, OpenApiOperation>>;
    components?: { schemas?: Record<string, unknown> };
}

describe('menu API OpenAPI contract', () => {
    it('documents exactly the two public operations', async () => {
        const response = await createApp().request('/openapi.json');
        const spec = (await response.json()) as OpenApiDocument;

        expect(response.status).toBe(200);
        expect(Object.keys(spec.paths).sort()).toEqual([
            '/api/v1/books/{bookId}/exchange-rates',
            '/api/v1/books/{bookId}/exchange-update',
        ]);
        expect(Object.keys(spec.paths['/api/v1/books/{bookId}/exchange-rates'])).toEqual(['get']);
        expect(Object.keys(spec.paths['/api/v1/books/{bookId}/exchange-update'])).toEqual(['post']);
        expect(spec.paths['/events']).toBeUndefined();
        expect(spec.paths['/health']).toBeUndefined();
    });

    it('uses the shared rates schema and a Bkper Transaction array response', async () => {
        const response = await createApp().request('/openapi.json');
        const spec = (await response.json()) as OpenApiDocument;
        const schemas = spec.components?.schemas ?? {};
        const getOperation = spec.paths['/api/v1/books/{bookId}/exchange-rates'].get;
        const postOperation = spec.paths['/api/v1/books/{bookId}/exchange-update'].post;

        expect(getOperation.responses?.['200'].content?.['application/json'].schema).toEqual({
            $ref: '#/components/schemas/ExchangeRates',
        });
        expect(postOperation.responses?.['200'].content?.['application/json'].schema).toEqual({
            type: 'array',
            items: { $ref: '#/components/schemas/BkperTransaction' },
        });
        expect(getOperation.responses?.['502']).toBeDefined();
        expect(postOperation.responses?.['502']).toBeUndefined();
        expect(schemas.BkperTransaction).toEqual({
            type: 'object',
            additionalProperties: true,
        });
    });
});
