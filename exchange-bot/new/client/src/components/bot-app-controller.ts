import type { ReactiveController } from 'lit';
import { Utils } from './../utils.js';
import { authService } from './../services/auth-service.js';
import { bookService } from './../services/book-service.js';
import { botApiService } from './../services/bot-api-service.js';
import type { BotAppView } from './bot-app-view.js';

export enum BotAppState {
    LOADING = 'LOADING',
    READY = 'READY',
    ERROR = 'ERROR',
}

export class BotAppController implements ReactiveController {
    private readonly view: BotAppView;
    private ratesRequestId = 0;

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
            this.view.appState = BotAppState.READY;

            await this.loadRates();
        } catch (error: unknown) {
            this.view.error = this.formatError(error, 'The selected Book could not be loaded');
            this.view.appState = BotAppState.ERROR;
        }
    }

    async loadRates(): Promise<void> {
        const requestId = ++this.ratesRequestId;

        const book = this.view.book;
        if (!book) {
            return;
        }

        const date = this.view.date;
        if (!date) {
            this.view.ratesLoading = false;
            this.view.ratesError = '';
            this.view.exchangeRates = undefined;
            return;
        }

        this.view.ratesLoading = true;
        this.view.ratesError = '';
        this.view.exchangeRates = undefined;

        try {
            const exchangeRates = await botApiService.loadExchangeRates(book.getId(), date);
            if (requestId === this.ratesRequestId) {
                this.view.exchangeRates = exchangeRates;
            }
        } catch (error: unknown) {
            if (requestId === this.ratesRequestId) {
                this.view.ratesError = this.formatError(
                    error,
                    'Exchange rates could not be loaded'
                );
            }
        } finally {
            if (requestId === this.ratesRequestId) {
                this.view.ratesLoading = false;
            }
        }
    }

    private formatError(error: unknown, message: string): string {
        return error instanceof Error ? error.message : message;
    }
}
