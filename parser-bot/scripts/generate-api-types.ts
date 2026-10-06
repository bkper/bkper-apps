import { mkdir, readFile, writeFile } from 'node:fs/promises';
import openapiTS, { astToString } from 'openapi-typescript';
import ts from 'typescript';
import { openApiDocument } from '../src/api/openapi.js';

const typesUrl = new URL('../src/api/generated/types.d.ts', import.meta.url);
const snapshotUrl = new URL('../test/api/openapi.snapshot.json', import.meta.url);
const ast = await openapiTS(JSON.stringify(openApiDocument), {
    inject: "import '@bkper/bkper-api-types';",
    transform: schema => {
        const type = schema['x-typescript-type'];
        return typeof type === 'string' ? ts.factory.createTypeReferenceNode(type) : undefined;
    },
});
const files = [
    { url: typesUrl, content: `/** Generated from /openapi.json. Do not edit directly. */\n${astToString(ast)}` },
    { url: snapshotUrl, content: `${JSON.stringify(openApiDocument, null, 2)}\n` },
];
for (const file of files) {
    if (process.argv.includes('--check')) {
        if (await readFile(file.url, 'utf8') !== file.content) throw new Error(`Stale API contract: ${file.url.pathname}`);
    } else {
        await mkdir(new URL('.', file.url), { recursive: true });
        await writeFile(file.url, file.content);
    }
}
