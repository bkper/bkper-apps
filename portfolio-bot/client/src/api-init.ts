import { Bkper } from 'bkper-js';
import { appEnv } from './app-env';
import { authService } from './services/auth-service.js';

export function initBkperAPI(): void {
    Bkper.setConfig({
        requestRetryHandler: async (code, message, attempt) => {
            if (code == 403 && attempt && attempt <= 1) {
                await authService.refresh();
            }
        },
        oauthTokenProvider: async () => {
            return authService.accessToken;
        },
        requestErrorHandler: (error: any) => {
            return errorHandler(error);
        },
        apiKeyProvider: async () => {
            return appEnv.getBkperApiKey();
        },
    });
}

function errorHandler(err: any): { status: number; message: string } {
    if (typeof err.status === 'number' && typeof err.message === 'string') {
        return err;
    }
    let error = err.response?.data?.error || err.data?.error || err.error;
    if (error) {
        return { status: error.code, message: error.message };
    }
    return { status: 500, message: err.message || err };
}
