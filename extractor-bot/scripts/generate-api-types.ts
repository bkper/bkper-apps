import { mkdir, readFile, writeFile } from 'node:fs/promises';
import openapiTS, { astToString } from 'openapi-typescript';
import ts from 'typescript';
import { openApiDocument } from '../src/api/openapi.js';

const typesUrl = new URL('../src/api/generated/types.d.ts', import.meta.url);
const snapshotUrl = new URL('../test/api/openapi.snapshot.json', import.meta.url);
// Bookbot's published discovery contract, copied from bookbot/test/api/openapi.snapshot.json.
const bookbotContractUrl = new URL('../src/clients/bookbot/openapi.json', import.meta.url);
const bookbotTypesUrl = new URL('../src/clients/bookbot/types.d.ts', import.meta.url);

async function generateTypes(document: string, source: string): Promise<string> {
    const ast = await openapiTS(document, {
        inject: "import '@bkper/bkper-api-types';",
        transform: schema => {
            const type = schema['x-typescript-type'];
            return typeof type === 'string' ? ts.factory.createTypeReferenceNode(type) : undefined;
        },
    });
    return `/** Generated from ${source}. Do not edit directly. */\n${astToString(ast)}`;
}

const files = [
    { url: typesUrl, content: await generateTypes(JSON.stringify(openApiDocument), '/openapi.json') },
    { url: snapshotUrl, content: `${JSON.stringify(openApiDocument, null, 2)}\n` },
    { url: bookbotTypesUrl, content: await generateTypes(await readFile(bookbotContractUrl, 'utf8'), "Bookbot's /openapi.json") },
];
for (const file of files) {
    if (process.argv.includes('--check')) {
        if (await readFile(file.url, 'utf8') !== file.content) throw new Error(`Stale API contract: ${file.url.pathname}`);
    } else {
        await mkdir(new URL('.', file.url), { recursive: true });
        await writeFile(file.url, file.content);
    }
}
