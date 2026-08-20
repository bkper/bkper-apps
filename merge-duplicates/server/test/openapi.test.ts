import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'bun:test';
import app from '../src/index';

const snapshotUrl = new URL('./openapi.snapshot.json', import.meta.url);

describe('Merge Duplicates OpenAPI contract', () => {
    it('documents exactly the three authenticated domain operations', async () => {
        const response = await app.request('/openapi.json');
        const spec = (await response.json()) as {
            paths: Record<string, Record<string, unknown>>;
            security?: Record<string, string[]>[];
            components?: {
                securitySchemes?: Record<string, unknown>;
                schemas?: Record<string, Record<string, unknown>>;
            };
        };

        expect(response.status).toBe(200);
        expect(Object.keys(spec.paths).sort()).toEqual([
            '/api/v1/analyze',
            '/api/v1/learn',
            '/api/v1/merge',
        ]);
        expect(Object.keys(spec.paths['/api/v1/analyze'])).toEqual(['post']);
        expect(Object.keys(spec.paths['/api/v1/merge'])).toEqual(['post']);
        expect(Object.keys(spec.paths['/api/v1/learn'])).toEqual(['post']);
        expect(spec.paths['/api/v1/scan']).toBeUndefined();
        expect(spec.paths['/events']).toBeUndefined();
        expect(spec.security).toEqual([{ bearerAuth: [] }]);
        expect(spec.components?.securitySchemes?.bearerAuth).toEqual({
            type: 'http',
            scheme: 'bearer',
        });

        const analyzeRequest = spec.components?.schemas?.AnalyzeRequest as {
            properties?: { transactions?: Record<string, unknown> };
        };
        const suggestion = spec.components?.schemas?.Suggestion as {
            properties?: { transactions?: Record<string, unknown> };
        };
        expect(analyzeRequest.properties?.transactions).toMatchObject({ maxItems: 1000 });
        expect(suggestion.properties?.transactions).toMatchObject({ minItems: 2, maxItems: 2 });
        expect(spec.components?.schemas?.TransactionFingerprint).toBeUndefined();

        const canonicalTypes = {
            Account: 'bkper.Account',
            Book: 'bkper.Book',
            Group: 'bkper.Group',
            MergeResponse: 'bkper.Transaction',
            Transaction: 'bkper.Transaction',
        };
        for (const [schemaName, typescriptType] of Object.entries(canonicalTypes)) {
            expect(spec.components?.schemas?.[schemaName]?.['x-typescript-type']).toBe(
                typescriptType
            );
        }
        for (const schemaName of ['Account', 'Book', 'Group']) {
            expect(spec.components?.schemas?.[schemaName]).toEqual({
                type: 'object',
                additionalProperties: true,
                'x-typescript-type': canonicalTypes[schemaName as keyof typeof canonicalTypes],
            });
        }
        expect(spec.components?.schemas?.File).toBeUndefined();

        const transaction = spec.components?.schemas?.Transaction as {
            properties?: Record<string, unknown>;
        };
        expect(Object.keys(transaction.properties ?? {}).sort()).toEqual([
            'amount',
            'checked',
            'creditAccount',
            'date',
            'dateFormatted',
            'debitAccount',
            'description',
            'id',
            'posted',
            'properties',
            'trashed',
        ]);

        const mergeRequest = spec.components?.schemas?.MergeRequest as {
            properties?: { primary?: Record<string, unknown> };
        };
        const learnRequest = spec.components?.schemas?.LearnRequest as {
            properties?: {
                examples?: { items?: { items?: Record<string, unknown> } };
            };
        };
        expect(mergeRequest.properties?.primary?.['x-typescript-type']).toBeUndefined();
        expect(
            learnRequest.properties?.examples?.items?.items?.['x-typescript-type']
        ).toBeUndefined();
    });

    it('matches the reviewed contract snapshot', async () => {
        const response = await app.request('/openapi.json');
        const spec = (await response.json()) as {
            paths: Record<string, unknown>;
            components?: Record<string, unknown>;
            security?: Record<string, string[]>[];
        };
        const expected = JSON.parse(await readFile(snapshotUrl, 'utf8')) as unknown;

        expect({
            paths: spec.paths,
            components: spec.components ?? {},
            security: spec.security ?? [],
        }).toEqual(expected);
    });
});
