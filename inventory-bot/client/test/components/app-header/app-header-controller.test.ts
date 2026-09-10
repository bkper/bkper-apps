import { afterEach, describe, expect, it } from 'bun:test';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { AppHeaderController } from '../../../src/components/app-header/app-header-controller.js';
import type { AppHeaderView } from '../../../src/components/app-header/app-header-view.js';

class TestHost implements ReactiveControllerHost {
    controller?: ReactiveController;
    updateRequests = 0;
    readonly updateComplete = Promise.resolve(true);

    addController(controller: ReactiveController): void {
        this.controller = controller;
    }

    removeController(): void {}

    requestUpdate(): void {
        this.updateRequests++;
    }
}

class TestMutationObserver {
    static instance?: TestMutationObserver;
    readonly callback: MutationCallback;
    disconnected = false;
    observedOptions?: MutationObserverInit;
    observedTarget?: Node;

    constructor(callback: MutationCallback) {
        this.callback = callback;
        TestMutationObserver.instance = this;
    }

    observe(target: Node, options?: MutationObserverInit): void {
        this.observedTarget = target;
        this.observedOptions = options;
    }

    disconnect(): void {
        this.disconnected = true;
    }

    takeRecords(): MutationRecord[] {
        return [];
    }
}

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalMutationObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');

afterEach(() => {
    TestMutationObserver.instance = undefined;
    if (originalDocument) {
        Object.defineProperty(globalThis, 'document', originalDocument);
    } else {
        Reflect.deleteProperty(globalThis, 'document');
    }
    if (originalMutationObserver) {
        Object.defineProperty(globalThis, 'MutationObserver', originalMutationObserver);
    } else {
        Reflect.deleteProperty(globalThis, 'MutationObserver');
    }
});

describe('App header controller', () => {
    it('observes theme class changes while its host is connected', () => {
        const documentElement = {} as HTMLElement;
        const runtimeDocument = {
            cookie: 'bkper_theme=light',
            documentElement,
        };
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: runtimeDocument,
        });
        Object.defineProperty(globalThis, 'MutationObserver', {
            configurable: true,
            value: TestMutationObserver,
        });
        const host = new TestHost();
        const controller = new AppHeaderController(host as unknown as AppHeaderView);

        controller.hostConnected();
        const observer = TestMutationObserver.instance;

        expect(host.controller).toBe(controller);
        expect(controller.isDark).toBe(false);
        expect(observer?.observedTarget).toBe(documentElement);
        expect(observer?.observedOptions).toEqual({
            attributes: true,
            attributeFilter: ['class'],
        });
        runtimeDocument.cookie = 'bkper_theme=dark';
        observer?.callback([], observer as unknown as MutationObserver);

        expect(controller.isDark).toBe(true);
        expect(host.updateRequests).toBe(1);

        controller.hostDisconnected();
        expect(observer?.disconnected).toBe(true);

        runtimeDocument.cookie = 'bkper_theme=light';
        controller.hostConnected();

        expect(controller.isDark).toBe(false);
        expect(host.updateRequests).toBe(2);
    });
});
