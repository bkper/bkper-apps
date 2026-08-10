import { Book, Transaction } from 'bkper-js';
import type { ReactiveController } from 'lit';
import { botApiService } from './../../services/bot-api-service.js';
import { Utils } from './../../utils.js';
import type { BotAppBook, ExchangeUpdateView } from './exchange-update-view.js';

export enum ExchangeUpdateStatus {
    WAITING = 'WAITING',
    COMPLETE = 'COMPLETE',
    ERROR = 'ERROR',
}

export interface ExchangeUpdateResult {
    status: ExchangeUpdateStatus;
    summary?: string;
    error?: string;
}

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
                this.view.results = new Map();
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

    async runExchangeUpdate(): Promise<void> {
        const exchangeRates = this.view.exchangeRates;
        if (!exchangeRates || this.view.executing) {
            return;
        }

        const baseBooks = this.view.books.filter(book => book.isBase);
        this.view.results = new Map(
            baseBooks.map(book => [book.id, { status: ExchangeUpdateStatus.WAITING }])
        );
        this.view.executing = true;

        try {
            await Promise.all(
                baseBooks.map(async book => {
                    try {
                        const transactionPayloads = await botApiService.performExchangeUpdate(
                            book.id,
                            exchangeRates
                        );
                        this.setExchangeUpdateResult(book.id, {
                            status: ExchangeUpdateStatus.COMPLETE,
                            summary: this.summarizeAcceptedTransactions(book, transactionPayloads),
                        });
                    } catch (error: unknown) {
                        this.setExchangeUpdateResult(book.id, {
                            status: ExchangeUpdateStatus.ERROR,
                            error: this.formatError(
                                error,
                                'Exchange Update could not be completed. Please try again.'
                            ),
                        });
                    }
                })
            );
        } finally {
            this.view.executing = false;
        }
    }

    private summarizeAcceptedTransactions(
        appBook: BotAppBook,
        transactionPayloads: bkper.Transaction[]
    ): string {
        const book = new Book({ id: appBook.id, fractionDigits: appBook.fractionDigits });
        const transactions = transactionPayloads.map(tx => new Transaction(book, tx));
        const summary = Utils.summarizeExchangeUpdateTransactions(transactions);
        return JSON.stringify(
            Object.fromEntries(
                Array.from(summary, ([accountName, amount]) => [
                    accountName,
                    book.round(amount).toFixed(book.getFractionDigits()),
                ])
            )
        );
    }

    private setExchangeUpdateResult(bookId: string, result: ExchangeUpdateResult): void {
        const results = new Map(this.view.results);
        results.set(bookId, result);
        this.view.results = results;
    }

    private formatError(error: unknown, message: string): string {
        return error instanceof Error ? error.message : message;
    }
}
