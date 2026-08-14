import { describe, expect, it } from 'bun:test';
import { Book, Permission } from 'bkper-js';
import { BotAppErrors } from '../../src/components/bot-app-errors.js';

describe('Bot app errors', () => {
    it('formats insufficient view permissions from the shared allowlist', () => {
        expect(
            BotAppErrors.insufficientViewPermission(new Book({ permission: Permission.RECORDER }))
                .message.before
        ).toBe('Required Book permission: VIEWER, POSTER, EDITOR, or OWNER. Current: RECORDER.');
        expect(BotAppErrors.insufficientViewPermission(new Book({})).message.before).toBe(
            'Required Book permission: VIEWER, POSTER, EDITOR, or OWNER. Current: unavailable.'
        );
    });

    it('builds the Book access action from the supplied Book id', () => {
        const error = BotAppErrors.bookAccessRequired('book-id');

        expect(error.type).toBe('info');
        expect(error.message.action).toEqual({
            label: 'Request access',
            url: 'https://bkper.app/books/book-id/transactions',
        });
    });

    it('builds the Exchange Bot installation action for the selected Book', () => {
        const error = BotAppErrors.appInstallationNotVerified('book/id');

        expect(error.message.action).toEqual({
            label: 'install',
            url: 'https://bkper.app/automations/book%2Fid/apps/exchange-bot',
        });
    });

    it('identifies one or multiple Books missing edit permission', () => {
        const namedBook = {
            book: new Book({ id: 'named-id', name: 'USD Book' }),
            excCode: 'USD',
            isBase: true,
        };
        const codedBook = {
            book: new Book({ id: 'coded-id' }),
            excCode: 'BRL',
            isBase: true,
        };
        const identifiedBook = {
            book: new Book({ id: 'identified-id' }),
            excCode: undefined,
            isBase: true,
        };

        expect(BotAppErrors.insufficientEditPermission([namedBook]).type).toBe('error');
        expect(BotAppErrors.insufficientEditPermission([namedBook]).message.before).toBe(
            'User needs EDITOR or OWNER permission in the following books: USD Book book'
        );
        expect(
            BotAppErrors.insufficientEditPermission([namedBook, codedBook, identifiedBook]).message
                .before
        ).toBe(
            'User needs EDITOR or OWNER permission in the following books: USD Book, BRL, identified-id books'
        );
    });
});
