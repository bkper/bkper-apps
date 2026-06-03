import type { Env } from '../../env.js';

export default {
    fetch(request: Request, env: Env): Response | Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === '/health') {
            return Response.json({ status: 'ok' });
        }

        return env.ASSETS.fetch(request);
    },
};
