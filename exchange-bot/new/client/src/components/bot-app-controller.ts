import type { ReactiveController } from 'lit';
import { authService } from './../services/auth-service.js';
import type { BotAppView } from './bot-app-view.js';

export enum BotAppState {
    LOADING = 'LOADING',
    AUTHENTICATED = 'AUTHENTICATED',
}

export class BotAppController implements ReactiveController {
    private readonly view: BotAppView;

    constructor(view: BotAppView) {
        this.view = view;
        this.view.addController(this);
    }

    hostConnected(): void {
        this.initialize();
    }

    async initialize(): Promise<void> {
        await authService.init();
        if (!authService.accessToken) {
            return;
        }
        this.view.state = BotAppState.AUTHENTICATED;
    }
}
