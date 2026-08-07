import { describe, expect, it } from 'bun:test';
import { Book, Permission } from 'bkper-js';
import type { TemplateResult } from 'lit';
import { BotAppView } from '../../src/components/bot-app-view.js';

type RateChangeHandler = (this: BotAppView, code: string, event: Event) => void;

const handleRateChanged = Reflect.get(
    BotAppView.prototype,
    'handleRateChanged'
) as RateChangeHandler;
const renderPermissionError = Reflect.get(BotAppView.prototype, 'renderPermissionError') as (
    this: BotAppView
) => TemplateResult;

describe('Bot app view', () => {
    it('passes the selected Book to the app header', () => {
        const view = new BotAppView();
        const book = new Book({
            id: 'book-id',
            name: 'USD Book',
            timeZone: 'America/New_York',
            permission: Permission.EDITOR,
        });
        view.book = book;

        const result = view.render();

        expect(result.values[0]).toBe(book);
    });

    it('renders menu initialization warnings', () => {
        const view = new BotAppView();
        view.permissionError = 'There are pending bot tasks in USD book';

        const result = renderPermissionError.call(view);

        expect(result.values).toContain('There are pending bot tasks in USD book');
    });

    it('updates a zero exchange rate', () => {
        const view = new BotAppView();
        view.exchangeRates = {
            base: 'USD',
            date: '2026-08-05',
            rates: { ZERO: 0 },
        };

        handleRateChanged.call(view, 'ZERO', {
            currentTarget: { value: '1.25' },
        } as unknown as Event);

        expect(view.exchangeRates.rates.ZERO).toBe('1.25');
    });
});
