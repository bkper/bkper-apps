import { describe, expect, it } from 'bun:test';
import { Account, AccountType, Book, Group, Permission } from 'bkper-js';
import { Utils } from '../src/utils.js';

function createMessage(
    data: unknown,
    origin = 'https://bkper.app',
    source: unknown = self
): MessageEvent<unknown> {
    const event = new MessageEvent<unknown>('message', { data, origin });
    Object.defineProperty(event, 'source', { value: source });
    return event;
}

describe('Utils', () => {
    it('uses explicit view, edit, and owner permission checks', () => {
        const cases = [
            { permission: Permission.OWNER, canView: true, canEdit: true, isOwner: true },
            { permission: Permission.EDITOR, canView: true, canEdit: true, isOwner: false },
            { permission: Permission.POSTER, canView: true, canEdit: false, isOwner: false },
            { permission: Permission.VIEWER, canView: true, canEdit: false, isOwner: false },
            { permission: Permission.RECORDER, canView: false, canEdit: false, isOwner: false },
            { permission: Permission.NONE, canView: false, canEdit: false, isOwner: false },
            { permission: undefined, canView: false, canEdit: false, isOwner: false },
        ] as const;

        for (const permissionCase of cases) {
            const book = new Book({ id: 'book-id', permission: permissionCase.permission });
            expect(Utils.canViewBook(book)).toBe(permissionCase.canView);
            expect(Utils.canEditBook(book)).toBe(permissionCase.canEdit);
            expect(Utils.isBookOwner(book)).toBe(permissionCase.isOwner);
        }
    });

    it('requires permanent Inventory Accounts with an exchange code', async () => {
        const book = new Book({ id: 'inventory-book' });
        const emptyGroup = new Group(book, { id: 'empty', properties: { exc_code: '  ' } });
        const usdGroup = new Group(book, { id: 'usd', properties: { exc_code: 'USD' } });
        const asset = new Account(book, {
            id: 'asset',
            name: 'Asset',
            type: AccountType.ASSET,
            permanent: true,
            archived: false,
        });
        asset.getGroups = async () => [emptyGroup, usdGroup];
        const archived = new Account(book, {
            id: 'archived',
            type: AccountType.ASSET,
            permanent: true,
            archived: true,
        });
        archived.getGroups = async () => [usdGroup];
        const missingExchange = new Account(book, {
            id: 'missing-exchange',
            type: AccountType.ASSET,
            permanent: true,
            archived: false,
        });
        missingExchange.getGroups = async () => [emptyGroup];
        const liability = new Account(book, {
            id: 'liability',
            type: AccountType.LIABILITY,
            permanent: true,
        });
        liability.getGroups = async () => [usdGroup];
        const incoming = new Account(book, {
            id: 'incoming',
            type: AccountType.INCOMING,
            permanent: false,
        });
        incoming.getGroups = async () => [usdGroup];

        expect(await Utils.getExchangeCode(asset)).toBe('USD');
        expect(await Utils.getExchangeCode(liability)).toBe('USD');
        expect(await Utils.getExchangeCode(incoming)).toBeNull();
        expect(await Utils.isEligibleInventoryAccount(asset)).toBe(true);
        expect(await Utils.isEligibleInventoryAccount(liability)).toBe(true);
        expect(await Utils.isEligibleInventoryAccount(incoming)).toBe(false);
        expect(await Utils.isEligibleInventoryAccount(archived)).toBe(true);
        expect(await Utils.isEligibleInventoryAccount(missingExchange)).toBe(false);
        expect(await Utils.getExchangeCodes([asset, liability, incoming])).toEqual(
            new Set(['USD'])
        );
    });

    it('accepts only trusted Bkper App URL change messages', () => {
        const url = 'https://inventory-bot.bkper.app/?bookId=book-id';
        const validMessage = { type: 'bkper:app-url-changed', url };
        const invalidEvents = [
            createMessage(validMessage, 'https://example.com'),
            createMessage(validMessage, 'https://bkper.app', null),
            createMessage(null),
            createMessage('message'),
            createMessage({}),
            createMessage({ type: 'other', url }),
            createMessage({ type: 'bkper:app-url-changed', url: 42 }),
        ];

        expect(
            Utils.isTrustedAppUrlChangeEvent(createMessage(validMessage), self, 'https://bkper.app')
        ).toBe(true);
        for (const event of invalidEvents) {
            expect(Utils.isTrustedAppUrlChangeEvent(event, self, 'https://bkper.app')).toBe(false);
        }
    });

    it('returns the calendar date in the Book timezone', () => {
        const date = new Date('2026-01-01T00:30:00.000Z');

        expect(Utils.getIsoDateInTimeZone(date, 'America/New_York')).toBe('2025-12-31');
        expect(Utils.getIsoDateInTimeZone(date, 'Asia/Tokyo')).toBe('2026-01-01');
    });
});
