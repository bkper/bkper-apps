import { authService } from './auth-service.js';
import { HttpError, HttpRequest } from './http-request.js';

export abstract class HttpAPIRequest<ResponseType> extends HttpRequest<ResponseType> {
    async execute(): Promise<ResponseType> {
        return this.executeWithAuthRetry(false);
    }

    private async executeWithAuthRetry(retried: boolean): Promise<ResponseType> {
        this.setHeader('authorization', `Bearer ${authService.accessToken}`);
        try {
            return await super.fetch();
        } catch (error: unknown) {
            if (
                error instanceof HttpError &&
                error.status === 401 &&
                this.getMethod() === 'GET' &&
                !retried
            ) {
                await authService.refresh();
                return this.executeWithAuthRetry(true);
            }
            throw error;
        }
    }
}
