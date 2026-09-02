import { describe, expect, it } from 'bun:test';
import { createApp } from '../../src/index.js';

interface OpenApiDocument {
    info: { title: string; version: string };
    paths: Record<string, unknown>;
}

describe('Inventory Bot OpenAPI skeleton', () => {
    it('publishes metadata without locking in operation routes', async () => {
        const response = await createApp().request('/openapi.json');
        const spec = (await response.json()) as OpenApiDocument;

        expect(response.status).toBe(200);
        expect(spec.info).toEqual({ title: 'Inventory Bot API', version: '1.0.0' });
        expect(spec.paths).toEqual({});
    });
});
