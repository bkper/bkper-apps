import { HttpAPIRequest } from './http-api-request.js';

class BotApiRequest<ResponseType> extends HttpAPIRequest<ResponseType> {}

export class BotApiError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
    }
}

class BotApiService {}

export const botApiService = new BotApiService();
