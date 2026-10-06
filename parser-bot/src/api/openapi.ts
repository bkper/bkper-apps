import { z } from 'zod';
import { AccountSchema, FileSchema, TransactionSchema, ParseRequestSchema, ParseResultSchema, ErrorResponseSchema } from './schemas.js';

const registry = z.registry<{ id: string }>();
for (const [id, schema] of Object.entries({
    Account: AccountSchema,
    File: FileSchema,
    Transaction: TransactionSchema,
    ParseRequest: ParseRequestSchema,
    ParseResult: ParseResultSchema,
    ErrorResponse: ErrorResponseSchema,
})) {
    registry.add(schema, { id });
}

function jsonContent(schema: string) {
    return { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } };
}

export const openApiDocument = {
    openapi: '3.0.3',
    info: {
        title: 'Parser Bot API',
        version: '1.0.0',
        description: 'Read-only parsing using the existing automatic file router. Supply a canonical File, Transaction, or both; at least one is required. A File may contain base64 content or an ID in the authorized Book. Transaction-only requests use the first attachment when present, otherwise extract missing amount/date from the description. With both inputs, attachment extraction preserves supplied fields and properties. File metadata is extracted only when configured. Prompt lookup does not persist legacy migrations. Results are unrecorded draft suggestions without native transaction IDs; extracted cross-Book targets require read access. parsed means transaction fields or file properties were extracted; empty means none were extracted. Failures return no partial suggestions and a safe error. Valid requests return HTTP 200; inspect outcome. Malformed requests return HTTP 400. No Book writes, posting, discovery, installation check, batch route, or recording summary is performed. The Platform owns bearer authentication, outbound attribution, and AI allowance; caller identities never select permissions or allowance.',
    },
    security: [{ bearerAuth: [] }],
    paths: {
        '/api/v1/parse': {
            post: {
                operationId: 'parse',
                requestBody: { required: true, content: jsonContent('ParseRequest') },
                responses: {
                    200: { description: 'Unrecorded parsing results. Inspect outcome and error.', content: jsonContent('ParseResult') },
                    400: { description: 'Invalid parse request.', content: jsonContent('ErrorResponse') },
                    401: { description: 'Platform authentication required.' },
                },
            },
        },
    },
    components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
        schemas: z.toJSONSchema(registry, { target: 'openapi-3.0', uri: id => `#/components/schemas/${id}` }).schemas,
    },
};
