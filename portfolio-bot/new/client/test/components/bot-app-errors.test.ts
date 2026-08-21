import { describe, expect, it } from 'bun:test';
import { Book, Permission } from 'bkper-js';
import { BotAppErrors } from '../../src/components/bot-app-errors.js';

describe('Bot app errors', () => {
    it('includes current and accepted permissions in the view-permission error', () => {
        const message = BotAppErrors.insufficientViewPermission(
            new Book({ permission: Permission.RECORDER })
        ).message.before;

        expect(message).toContain(Permission.RECORDER);
        expect(message).toContain(Permission.VIEWER);
        expect(message).toContain(Permission.POSTER);
        expect(message).toContain(Permission.EDITOR);
        expect(message).toContain(Permission.OWNER);
    });

    it('builds the Book access action from the supplied Book id', () => {
        const error = BotAppErrors.bookAccessRequired('book/id');

        expect(error.type).toBe('info');
        expect(error.message.action).toEqual({
            label: 'Request access',
            url: 'https://bkper.app/books/book%2Fid/transactions',
        });
    });

    it('identifies Portfolio Book access and permission failures', () => {
        const accessError = BotAppErrors.bookAccessRequired('portfolio/id', 'the Portfolio Book');
        const permissionError = BotAppErrors.insufficientViewPermission(
            new Book({ permission: Permission.RECORDER }),
            'Portfolio Book'
        );
        const notFoundError = BotAppErrors.bookNotFound('Portfolio Book');
        const loadError = BotAppErrors.bookLoadFailed('Portfolio Book');

        expect(accessError.title).toBe("You don't have access to the Portfolio Book.");
        expect(accessError.message.action?.url).toBe(
            'https://bkper.app/books/portfolio%2Fid/transactions'
        );
        expect(permissionError.title).toBe('Insufficient Portfolio Book permission.');
        expect(permissionError.message.before).toContain(Permission.RECORDER);
        expect(notFoundError.title).toBe('Portfolio Book not found.');
        expect(loadError.title).toBe('The Portfolio Book could not be loaded.');
    });

    it('builds the Portfolio Bot installation action for the selected Book', () => {
        const error = BotAppErrors.appInstallationNotVerified('book/id');

        expect(error.message.action).toEqual({
            label: 'install',
            url: 'https://bkper.app/automations/book%2Fid/apps/stock-bot',
        });
    });

    it('identifies Books missing edit permission by name or id', () => {
        const namedBook = { book: new Book({ id: 'named-id', name: 'Portfolio Book' }) };
        const identifiedBook = { book: new Book({ id: 'identified-id' }) };

        const error = BotAppErrors.insufficientEditPermission([namedBook, identifiedBook]);

        expect(error.type).toBe('error');
        expect(error.message.before).toContain('Portfolio Book');
        expect(error.message.before).toContain('identified-id');
    });
});
