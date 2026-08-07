import { afterEach, describe, expect, it } from 'bun:test';
import { APP_LOGO_URL_DARK, APP_LOGO_URL_LIGHT } from '../../../src/constants.js';
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
    it('uses the light logo when the selected Bkper theme is light', () => {
        setThemeCookie('light');
        const view = new AppHeaderView();

        expect(getAppLogoUrl.call(view)).toBe(APP_LOGO_URL_LIGHT);
    });

    it('uses the dark logo when the selected Bkper theme is dark', () => {
        setThemeCookie('dark');
        const view = new AppHeaderView();

        expect(getAppLogoUrl.call(view)).toBe(APP_LOGO_URL_DARK);
    });
});
