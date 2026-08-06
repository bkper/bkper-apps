import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { BotAppController, BotAppState } from '../src/bot-app-controller.js';
import type { BotAppView } from '../src/bot-app-view.js';
import { authService } from '../src/services/auth-service.js';

class TestView implements ReactiveControllerHost {
    state = BotAppState.LOADING;
    readonly controllers: ReactiveController[] = [];
    readonly updateComplete = Promise.resolve(true);

    addController(controller: ReactiveController): void {
        this.controllers.push(controller);
    }

    removeController(controller: ReactiveController): void {
        const index = this.controllers.indexOf(controller);
        if (index >= 0) {
            this.controllers.splice(index, 1);
        }
    }

    requestUpdate(): void {}
}

const originalInit = authService.init;

afterEach(() => {
    authService.init = originalInit;
    authService.accessToken = undefined;
});

function createController(view: TestView): BotAppController {
    return new BotAppController(view as unknown as BotAppView);
}

describe('Bot app controller', () => {
    it('keeps the app loading until authentication succeeds', async () => {
        authService.init = async () => {
            authService.accessToken = 'access-token';
        };
        const view = new TestView();
        const controller = createController(view);

        const initialization = controller.initialize();

        expect(view.state).toBe(BotAppState.LOADING);
        await initialization;
        expect(view.state).toBe(BotAppState.AUTHENTICATED);
    });

    it('stays loading when authentication does not establish a session', async () => {
        authService.init = async () => {};
        const view = new TestView();
        const controller = createController(view);

        await controller.initialize();

        expect(view.state).toBe(BotAppState.LOADING);
    });

    it('starts initialization when the view connects', async () => {
        authService.init = mock(async () => {});
        const view = new TestView();
        const controller = createController(view);

        controller.hostConnected();
        await Promise.resolve();

        expect(authService.init).toHaveBeenCalledTimes(1);
    });
});
