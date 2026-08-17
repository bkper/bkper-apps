export const openApiDocumentConfig = {
    openapi: '3.0.0' as const,
    info: {
        title: 'Merge Duplicates API',
        version: '1.0.0',
        description:
            'Human-confirmed duplicate analysis, canonical merge, and rejected-pair learning.',
    },
    servers: [
        { url: 'https://merge-duplicates.bkper.app', description: 'Production' },
        { url: 'https://merge-duplicates-preview.bkper.app', description: 'Preview' },
        { url: 'http://localhost:8795', description: 'Local Worker' },
    ],
    security: [{ bearerAuth: [] }],
};
