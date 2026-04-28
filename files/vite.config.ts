import { defineConfig } from 'vite';
import { createBkperAuthMiddleware } from 'bkper/dev';

export default defineConfig({
    root: 'packages/web/client',
    build: {
        outDir: '../../../dist/web/client',
        emptyOutDir: true,
    },
    plugins: [
        {
            name: 'bkper-auth',
            configureServer(server) {
                server.middlewares.use(createBkperAuthMiddleware());
            },
        },
    ],
    server: {
        port: 5174,
        proxy: { '/api': 'http://localhost:8788' },
    },
});
