import { describe, expect, it, mock } from 'bun:test';
import { Account, Book, Group } from 'bkper-js';
import * as constants from '../src/constants.js';
import { BOOKBOT_DISCOVERY_EXAMPLES_PROPERTY, LEGACY_AGENT_DISCOVERY_EXAMPLES_PROPERTY } from '../src/constants.js';
import { PromptLookupService } from '../src/services/PromptLookupService.js';

function account(properties: Record<string, string>, groups: Group[] = []): Account {
    const result = new Account(new Book({ id: 'book_1' }), { id: 'account_1', properties });
    result.getGroups = mock(async () => groups);
    return result;
}

function group(properties: Record<string, string>): Group {
    return new Group(new Book({ id: 'book_1' }), { id: 'group_1', properties });
}

describe('Bookbot property names', () => {
    it('keeps every new property key within Bkper\'s 30 characters, in normalized form, under bookbot_', () => {
        const newKeys = Object.entries(constants)
            .filter(([name]) => name.startsWith('BOOKBOT_'))
            .map(([, value]) => value as string);

        expect(newKeys.length).toBe(5);
        for (const key of newKeys) {
            expect(key.length).toBeLessThanOrEqual(30);
            expect(key).toMatch(/^bookbot_[a-z0-9]+(_[a-z0-9]+)*_?$/);
        }
    });

    describe('discovery examples', () => {
        const book = new Book({ id: 'book_1' });

        it('prefers bookbot_discovery_examples and still reads agent_discovery_examples', async () => {
            const service = new PromptLookupService();

            expect(await service.lookupDiscoveryExamples({
                book,
                account: account({ [BOOKBOT_DISCOVERY_EXAMPLES_PROPERTY]: 'New', [LEGACY_AGENT_DISCOVERY_EXAMPLES_PROPERTY]: 'Old' }),
            })).toBe('New');
            expect(await service.lookupDiscoveryExamples({
                book,
                account: account({ [LEGACY_AGENT_DISCOVERY_EXAMPLES_PROPERTY]: 'Old' }),
            })).toBe('Old');
            expect(await service.lookupDiscoveryExamples({
                book: new Book({ id: 'book_2', properties: { [LEGACY_AGENT_DISCOVERY_EXAMPLES_PROPERTY]: 'Book old' } }),
            })).toBe('Book old');
        });

        it('keeps the Account before its Group whatever name each uses', async () => {
            const examples = await new PromptLookupService().lookupDiscoveryExamples({
                book,
                account: account(
                    { [LEGACY_AGENT_DISCOVERY_EXAMPLES_PROPERTY]: 'Account' },
                    [group({ [BOOKBOT_DISCOVERY_EXAMPLES_PROPERTY]: 'Group' })]
                ),
            });

            expect(examples).toBe('Account');
        });
    });
});
