import { expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import app from '../../src/index.js';
import { openApiDocument } from '../../src/api/openapi.js';

it('serves the reviewed OpenAPI snapshot without requiring Book access', async () => {
    const response = await app.request('/openapi.json');
    const document = await response.json() as typeof openApiDocument;
    const snapshot = JSON.parse(await readFile(new URL('./openapi.snapshot.json', import.meta.url), 'utf8')) as typeof openApiDocument;

    expect(response.status).toBe(200);
    expect(document).toEqual(snapshot);
});
