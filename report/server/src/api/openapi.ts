export const openApiDocumentConfig = {
    openapi: '3.0.0' as const,
    info: {
        title: 'Report API',
        version: '1.0.0',
        description: 'Public API routes exposed by the Bkper Report app.',
    },
    servers: [
        { url: 'https://report.bkper.app', description: 'Production' },
        { url: 'https://report-preview.bkper.app', description: 'Preview' },
        { url: 'http://localhost:8809', description: 'Local Worker' },
    ],
};
