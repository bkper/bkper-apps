import { z } from 'zod';
import { AccountSchema, TransactionSchema, DiscoveryItemSchema, DiscoveryResultSchema, DiscoveryBatchSchema, DiscoveryBatchResultSchema, ErrorResponseSchema } from './schemas.js';

const registry = z.registry<{ id: string }>();
for (const [id, schema] of Object.entries({
    Account: AccountSchema,
    Transaction: TransactionSchema,
    DiscoveryItem: DiscoveryItemSchema,
    DiscoveryResult: DiscoveryResultSchema,
    DiscoveryBatch: DiscoveryBatchSchema,
    DiscoveryBatchResult: DiscoveryBatchResultSchema,
    ErrorResponse: ErrorResponseSchema,
})) {
    registry.add(schema, { id });
}

function jsonContent(schema: string) {
    return { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } };
}

function operation(operationId: string, request: string, response: string) {
    return {
        operationId,
        requestBody: { required: true, content: jsonContent(request) },
        responses: {
            200: { description: 'Read-only discovery results. Inspect each item outcome and error.', content: jsonContent(response) },
            400: { description: 'Invalid request or duplicate item identifiers.', content: jsonContent('ErrorResponse') },
            401: { description: 'Platform authentication required.' },
        },
    };
}

export const openApiDocument = {
    openapi: '3.0.3',
    info: {
        title: 'Bookbot Discovery API',
        version: '1.0.0',
        description: 'Discovers Accounts and historical properties without Book writes. Canonical transaction payloads are enriched locally. Existing discovery preserves supplied Account sides and visible properties, consumes parsed_account_name_, and updates its internal agent_* provenance. sourceAccount enables property enrichment from the history found by account discovery. Items run sequentially, reusing one discovery cache per target Book and its existing request limit. Item IDs are unique within a batch and are unrelated to native transaction IDs. No installation is required; every target Book requires read access. Creator hints are verified and never select permissions or AI allowance. The Platform owns authentication, app-chain attribution and AI allowance. No history datasets or frequency-based confidence are returned. no_change means both sides are supplied or the description is blank; no_match means discovery returned no Accounts. Errors return the original supplied transaction, including when only part of discovery succeeded.',
    },
    security: [{ bearerAuth: [] }],
    paths: {
        '/api/v1/discovery': { post: operation('discover', 'DiscoveryItem', 'DiscoveryResult') },
        '/api/v1/discovery/batch': { post: operation('discoverBatch', 'DiscoveryBatch', 'DiscoveryBatchResult') },
    },
    components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
        schemas: z.toJSONSchema(registry, { target: 'openapi-3.0', uri: id => `#/components/schemas/${id}` }).schemas,
    },
};
