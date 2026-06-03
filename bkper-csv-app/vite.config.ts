import { defineConfig } from 'vite';
import { createBkperAuthMiddleware } from 'bkper/dev';

const clientPort = 5176;
const serverPort = 8789;

export default defineConfig({
    root: 'client',
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
        port: clientPort,
        strictPort: true,
        proxy: { '/api': `http://localhost:${serverPort}` },
        hmr: {
            host: 'localhost',
            port: clientPort,
            clientPort,
        },
    },
});
