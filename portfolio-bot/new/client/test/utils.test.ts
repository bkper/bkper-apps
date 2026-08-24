import { describe, expect, it } from 'bun:test';
import { AccountType, Book, Permission } from 'bkper-js';
import { Utils } from '../src/utils.js';

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

    it('gets the first exchange code only for eligible instrument Accounts', async () => {
        const book = new Book({
            id: 'portfolio-book',
            groups: [
                { id: 'other-group', properties: {} },
                { id: 'exchange-group', properties: { stock_exc_code: 'USD' } },
            ],
            accounts: [
                {
                    id: 'instrument',
                    type: AccountType.ASSET,
                    groups: [{ id: 'other-group' }, { id: 'exchange-group' }],
                },
                {
                    id: 'incoming',
                    type: AccountType.INCOMING,
                    groups: [{ id: 'exchange-group' }],
                },
                {
                    id: 'missing-exchange',
                    type: AccountType.ASSET,
                    groups: [{ id: 'other-group' }],
                },
            ],
        });
        const instrument = await book.getAccount('instrument');
        const incoming = await book.getAccount('incoming');
        const missingExchange = await book.getAccount('missing-exchange');
        if (!instrument || !incoming || !missingExchange) {
            throw new Error('Expected Account fixtures');
        }

        expect(await Utils.getExchangeCode(instrument)).toBe('USD');
        expect(await Utils.getExchangeCode(incoming)).toBeNull();
        expect(await Utils.getExchangeCode(missingExchange)).toBeNull();
        expect(
            await Utils.getExchangeCodes([instrument, incoming, instrument, missingExchange])
        ).toEqual(new Set(['USD']));
    });

    it('identifies active permanent Portfolio Accounts assigned to an exchange', async () => {
        const book = new Book({
            id: 'portfolio-book',
            groups: [{ id: 'exchange-group', properties: { stock_exc_code: 'USD' } }],
            accounts: [
                {
                    id: 'eligible',
                    permanent: true,
                    groups: [{ id: 'exchange-group' }],
                },
                {
                    id: 'non-permanent',
                    permanent: false,
                    groups: [{ id: 'exchange-group' }],
                },
                {
                    id: 'archived',
                    permanent: true,
                    archived: true,
                    groups: [{ id: 'exchange-group' }],
                },
                { id: 'missing-exchange', permanent: true, groups: [] },
            ],
        });
        const eligible = await book.getAccount('eligible');
        const nonPermanent = await book.getAccount('non-permanent');
        const archived = await book.getAccount('archived');
        const missingExchange = await book.getAccount('missing-exchange');
        if (!eligible || !nonPermanent || !archived || !missingExchange) {
            throw new Error('Expected Account fixtures');
        }

        expect(await Utils.isEligiblePortfolioAccount(eligible)).toBe(true);
        expect(await Utils.isEligiblePortfolioAccount(nonPermanent)).toBe(false);
        expect(await Utils.isEligiblePortfolioAccount(archived)).toBe(false);
        expect(await Utils.isEligiblePortfolioAccount(missingExchange)).toBe(false);
    });

    it('returns the calendar date in the Book timezone', () => {
        const date = new Date('2026-01-01T00:30:00.000Z');

        expect(Utils.getIsoDateInTimeZone(date, 'America/New_York')).toBe('2025-12-31');
        expect(Utils.getIsoDateInTimeZone(date, 'Asia/Tokyo')).toBe('2026-01-01');
    });
});
