import { defineConfig } from 'vite';
import { createBkperAuthMiddleware } from 'bkper/dev';

// Ports assigned to this app in the bkper-apps monorepo; `bkper app dev` uses the same pair.
const CLIENT_PORT = 5207;
const WORKER_URL = 'http://127.0.0.1:8809';

// BKPER_LIVE_HOST: the host that shows this dev server live (set by the Bkper Agent's sandbox).
// When set, Vite accepts that host and HMR goes through the page's own origin.
export default defineConfig(() => {
    const liveHost = process.env.BKPER_LIVE_HOST;

    return {
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
            port: CLIENT_PORT,
            strictPort: true,
            proxy: {
                '/api': WORKER_URL,
                '/openapi.json': WORKER_URL,
            },
            ...(liveHost
                ? { allowedHosts: [liveHost] }
                : { hmr: { host: 'localhost', port: CLIENT_PORT, clientPort: CLIENT_PORT } }),
        },
    };
});
