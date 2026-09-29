import { BkperAuth, type BkperAuthConfig } from '@bkper/web-auth';
import { appEnv } from '../app-env.js';

class AuthService {
    private bkperAuthClient?: BkperAuth;

    accessToken: string | undefined;

    async init(): Promise<void> {
        if (appEnv.isOffline() || this.bkperAuthClient) {
            return;
        }
        return this.initBkperAuthClient();
    }

    async refresh(): Promise<void> {
        try {
            await this.bkperAuthClient?.refresh();
            this.accessToken = this.bkperAuthClient?.getAccessToken();
            if (!this.accessToken) {
                throw new Error('Authentication required. Please sign in again.');
            }
        } catch (error: unknown) {
            this.accessToken = undefined;
            throw error;
        }
    }

    private async initBkperAuthClient(): Promise<void> {
        if (this.bkperAuthClient) {
            return;
        }
        const config: BkperAuthConfig = {
            baseUrl: appEnv.getAuthBaseUrl(),
            onLoginSuccess: () => {
                this.accessToken = this.bkperAuthClient?.getAccessToken();
            },
            onLoginRequired: () => {
                this.bkperAuthClient?.login();
            },
            onTokenRefresh: token => {
                this.accessToken = token;
            },
            onError: error => {
                console.error('Authentication initialization failed', error);
            },
        };
        this.bkperAuthClient = new BkperAuth(config);
        await this.bkperAuthClient.init();
    }
}

export const authService = new AuthService();
