import { isDarkTheme } from '@bkper/web-components/theme';
import type { ReactiveController } from 'lit';
import type { AppHeaderView } from './app-header-view.js';

export class AppHeaderController implements ReactiveController {
    private readonly view: AppHeaderView;

    private themeObserver?: MutationObserver;
    private dark = isDarkTheme();

    constructor(view: AppHeaderView) {
        this.view = view;
        this.view.addController(this);
    }

    get isDark(): boolean {
        return this.dark;
    }

    hostConnected(): void {
        this.updateTheme();
        this.themeObserver ??= new MutationObserver(() => this.updateTheme());
        this.themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class'],
        });
    }

    hostDisconnected(): void {
        this.themeObserver?.disconnect();
    }

    private updateTheme(): void {
        const dark = isDarkTheme();
        if (dark !== this.dark) {
            this.dark = dark;
            this.view.requestUpdate();
        }
    }
}
