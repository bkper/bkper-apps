import { describe, expect, it } from 'bun:test';
import { createApp } from '../../src/index.js';

interface OpenApiDocument {
    paths: Record<string, unknown>;
    components?: { schemas?: Record<string, unknown> };
}

describe('Portfolio Bot OpenAPI contract', () => {
    it('does not publish premature API operations', async () => {
        const response = await createApp().request('/openapi.json');
        const spec = (await response.json()) as OpenApiDocument;

        expect(response.status).toBe(200);
        expect(spec.paths).toEqual({});
    });

    it('publishes the shared API error schema for generated client types', async () => {
        const response = await createApp().request('/openapi.json');
        const spec = (await response.json()) as OpenApiDocument;

        expect(spec.components?.schemas?.ApiError).toBeDefined();
    });
});
