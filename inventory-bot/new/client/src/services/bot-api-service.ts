import { isApiError } from '../errors.js';
import { HttpAPIRequest } from './http-api-request.js';
import { HttpError } from './http-request.js';

class BotApiRequest<ResponseType> extends HttpAPIRequest<ResponseType> {}

export class BotApiError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
    }
}

class BotApiService {
    private async execute<ResponseType>(
        request: BotApiRequest<ResponseType>
    ): Promise<ResponseType> {
        try {
            return await request.execute();
        } catch (error: unknown) {
            if (error instanceof HttpError && isApiError(error.data)) {
                throw new BotApiError(error.data.error.message, error.status);
            }
            throw error;
        }
    }
}

export const botApiService = new BotApiService();
