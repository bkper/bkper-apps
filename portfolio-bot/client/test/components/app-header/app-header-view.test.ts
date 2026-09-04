import { afterEach, describe, expect, it } from 'bun:test';
import { App } from 'bkper-js';
import { AppHeaderView } from '../../../src/components/app-header/app-header-view.js';

type GetAppLogoUrl = (this: AppHeaderView) => string;

const getAppLogoUrl = Reflect.get(AppHeaderView.prototype, 'getAppLogoUrl') as GetAppLogoUrl;
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

afterEach(() => {
    if (originalDocument) {
        Object.defineProperty(globalThis, 'document', originalDocument);
    } else {
        Reflect.deleteProperty(globalThis, 'document');
    }
});

function setThemeCookie(theme: 'dark' | 'light'): void {
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: { cookie: `bkper_theme=${theme}` },
    });
}

describe('App header view', () => {
    it('renders the App name and passes the App to help', () => {
        const app = new App({ id: 'stock-bot', name: 'Global Portfolio Bot' });
        const view = new AppHeaderView();
        view.app = app;

        const result = view.render();

        expect(result.values).toContain('Global Portfolio Bot');
        expect(result.values).toContain(app);
    });

    it('uses the light App logo when the selected Bkper theme is light', () => {
        setThemeCookie('light');
        const view = new AppHeaderView();
        view.app = new App({ logoUrl: 'https://example.com/global-light.svg' });

        expect(getAppLogoUrl.call(view)).toBe('https://example.com/global-light.svg');
    });

    it('uses the dark App logo when the selected Bkper theme is dark', () => {
        setThemeCookie('dark');
        const view = new AppHeaderView();
        view.app = new App({ logoUrlDark: 'https://example.com/global-dark.svg' });

        expect(getAppLogoUrl.call(view)).toBe('https://example.com/global-dark.svg');
    });
});
