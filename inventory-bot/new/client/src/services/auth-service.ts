import { BkperAuth, type BkperAuthConfig } from '@bkper/web-auth';
import { appEnv } from '../app-env.js';

class AuthService {
    private bkperAuthClient?: BkperAuth;

    private initialization?: Promise<void>;

    accessToken: string | undefined;

    async init(): Promise<void> {
        if (appEnv.isOffline()) {
            return;
        }
        if (!this.initialization) {
            this.initialization = this.initBkperAuthClient();
        }
        await this.initialization;
    }

    async refresh(): Promise<void> {
        await this.bkperAuthClient?.refresh();
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
