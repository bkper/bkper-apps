import type { ReactiveController } from 'lit';
import { Utils } from './../utils.js';
import { authService } from './../services/auth-service.js';
import { bookService } from './../services/book-service.js';
import type { BotAppView } from './bot-app-view.js';

export enum BotAppState {
    LOADING = 'LOADING',
    READY = 'READY',
    ERROR = 'ERROR',
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
        try {
            await authService.init();
            if (!authService.accessToken) {
                return;
            }

            const bookId = new URL(self.location.href).searchParams.get('bookId');
            if (!bookId) {
                throw new Error('Error: Missing bookId URL param');
            }

            this.view.book = await bookService.loadBook(bookId);
            this.view.date = Utils.getIsoDateInTimeZone(new Date(), this.view.book.getTimeZone());
            this.view.state = BotAppState.READY;
        } catch (error: unknown) {
            this.view.error =
                error instanceof Error ? error.message : 'The selected Book could not be loaded';
            this.view.state = BotAppState.ERROR;
        }
    }
}
