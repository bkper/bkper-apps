import { defineConfig } from 'vite';
import { createBkperAuthMiddleware } from 'bkper/dev';

export default defineConfig({
    build: {
        outDir: '../dist/client',
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
        host: '::',
        port: 5177,
        strictPort: true,
        proxy: { '/api': 'http://127.0.0.1:8793' },
        hmr: {
            host: 'localhost',
            port: 5177,
            clientPort: 5177,
        },
    },
});
