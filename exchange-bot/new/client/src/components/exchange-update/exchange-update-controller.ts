import type { ReactiveController } from 'lit';
import { botApiService } from './../../services/bot-api-service.js';
import type { ExchangeUpdateView } from './exchange-update-view.js';

export class ExchangeUpdateController implements ReactiveController {
    private readonly view: ExchangeUpdateView;
    private ratesRequestId = 0;

    constructor(view: ExchangeUpdateView) {
        this.view = view;
        this.view.addController(this);
    }

    hostConnected(): void {
        this.initialize();
    }

    async initialize(): Promise<void> {
        const book = this.view.book;
        if (!book) {
            return;
        }
        await this.loadRates();
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
