import { describe, expect, it, mock } from 'bun:test';
import { Account, Book, File, Group } from 'bkper-js';
import * as constants from '../src/constants.js';
import {
    APP_PROPERTY_PREFIXES,
    EXTRACTOR_PROMPT_FILE_PROPERTY,
    EXTRACTOR_PROMPT_IMPROVE_PROPERTY,
    EXTRACTOR_PROMPT_TRANSACTION_PROPERTY,
    EXTRACTOR_PROMPT_TRANSACTIONS_PROPERTY,
    EXTRACTOR_URL_FILE_PROPERTY,
    EXTRACTOR_URL_TRANSACTIONS_PROPERTY,
    LEGACY_AGENT_FILE_ID_PROPERTY,
    LEGACY_AGENT_PARSER_FILE_PROPERTY,
    LEGACY_AGENT_PARSER_TRANSACTION_PROPERTY,
    LEGACY_AGENT_PARSER_TRANSACTIONS_PROPERTY,
    LEGACY_AGENT_PARSER_URL_FILE_PROPERTY,
    LEGACY_AGENT_PARSER_URL_TRANSACTIONS_PROPERTY,
    LEGACY_AGENT_PROMPT_IMPROVE_PROPERTY,
    LEGACY_AGENT_PROMPT_PROPERTY,
    LEGACY_AGENT_PROMPT_TRANSACTIONS_PROPERTY,
    EXTRACTOR_FILE_ID_PROPERTY,
} from '../src/constants.js';
import { filterFileProperties } from '../src/file-parsers/FileParserUtils.js';
import { FlagManagementService } from '../src/services/FlagManagementService.js';
import { LegacyPromptPropertyMigration } from '../src/services/LegacyPromptPropertyMigration.js';
import { JaroWinklerStringComparator, PromptImprovementServiceBase } from '../src/services/PromptImprovementServiceBase.js';
import { PromptLookupService } from '../src/services/PromptLookupService.js';

const book = new Book({ id: 'book_1' });

function account(properties: Record<string, string>, groups: Group[] = []): Account {
    const result = new Account(book, { id: 'account_1', name: 'Bank', properties });
    result.getGroups = mock(async () => groups);
    return result;
}

function group(properties: Record<string, string>): Group {
    return new Group(book, { id: 'group_1', name: 'Banks', properties });
}

/** Records the properties each update() sends, as one payload per call. */
function captureUpdates(entity: Account | Group): Array<Record<string, string>> {
    const sent: Array<Record<string, string>> = [];
    entity.update = mock(async () => {
        sent.push({ ...entity.json().properties });
        return entity;
    }) as never;
    return sent;
}

function readOnlyLookup(): PromptLookupService {
    return new PromptLookupService({ migrateLegacyPromptProperties: async () => {} }, false);
}

function fileFor(accountId: string): File {
    return new File(book, { properties: { account_id: accountId } });
}

class TestablePromptImprovement extends PromptImprovementServiceBase {
    constructor() {
        super(new JaroWinklerStringComparator());
    }

    save(entity: Account | Group, property: string, prompt: string): Promise<string | null> {
        return this.saveImprovedPrompt(entity, property, prompt, 'Because');
    }

    skips(key: string): boolean {
        return this.shouldSkipProperty(key);
    }
}

describe('Extractor Bot property names', () => {
    it('keeps every new property key within Bkper\'s 30 characters, in normalized form, under an app prefix', () => {
        const newKeys = Object.entries(constants)
            .filter(([name]) => name.startsWith('EXTRACTOR_') || name.startsWith('BOOKBOT_'))
            .map(([, value]) => value as string);

        expect(newKeys.length).toBeGreaterThan(10);
        for (const key of newKeys) {
            expect(key.length).toBeLessThanOrEqual(30);
            expect(key).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*_?$/);
            expect(APP_PROPERTY_PREFIXES.some((prefix) => key.startsWith(prefix))).toBe(true);
        }
    });

    describe('prompt migration', () => {
        it('renames agent_parser_* prompts to extractor_prompt_* and deletes the old keys in one update', async () => {
            const entity = account({
                [LEGACY_AGENT_PARSER_TRANSACTION_PROPERTY]: 'Invoices',
                [LEGACY_AGENT_PARSER_TRANSACTIONS_PROPERTY]: 'Statements',
                [LEGACY_AGENT_PARSER_FILE_PROPERTY]: 'Metadata',
                [LEGACY_AGENT_PARSER_URL_TRANSACTIONS_PROPERTY]: 'https://parser.example.com',
            });
            const sent = captureUpdates(entity);

            await new LegacyPromptPropertyMigration().migrateLegacyPromptProperties(entity);

            expect(sent).toHaveLength(1);
            expect(sent[0]).toMatchObject({
                [EXTRACTOR_PROMPT_TRANSACTION_PROPERTY]: 'Invoices',
                [EXTRACTOR_PROMPT_TRANSACTIONS_PROPERTY]: 'Statements',
                [EXTRACTOR_PROMPT_FILE_PROPERTY]: 'Metadata',
                [LEGACY_AGENT_PARSER_TRANSACTION_PROPERTY]: '',
                [LEGACY_AGENT_PARSER_TRANSACTIONS_PROPERTY]: '',
                [LEGACY_AGENT_PARSER_FILE_PROPERTY]: '',
                [LEGACY_AGENT_PARSER_URL_TRANSACTIONS_PROPERTY]: 'https://parser.example.com',
            });
        });

        it('keeps an existing extractor_prompt_* value and still deletes its old names', async () => {
            const entity = account({
                [EXTRACTOR_PROMPT_TRANSACTIONS_PROPERTY]: 'New statements',
                [LEGACY_AGENT_PARSER_TRANSACTIONS_PROPERTY]: 'Old statements',
                [LEGACY_AGENT_PROMPT_TRANSACTIONS_PROPERTY]: 'Older statements',
            });
            const sent = captureUpdates(entity);

            await new LegacyPromptPropertyMigration().migrateLegacyPromptProperties(entity);

            expect(sent).toHaveLength(1);
            expect(sent[0][EXTRACTOR_PROMPT_TRANSACTIONS_PROPERTY]).toBe('New statements');
            expect(sent[0][LEGACY_AGENT_PARSER_TRANSACTIONS_PROPERTY]).toBe('');
            expect(sent[0][LEGACY_AGENT_PROMPT_TRANSACTIONS_PROPERTY]).toBe('');
        });

        it('moves agent_prompt* prompts directly to extractor_prompt_*, preferring agent_parser_* over agent_prompt_*', async () => {
            const entity = account({
                [LEGACY_AGENT_PARSER_TRANSACTIONS_PROPERTY]: 'Parser statements',
                [LEGACY_AGENT_PROMPT_TRANSACTIONS_PROPERTY]: 'Prompt statements',
                [LEGACY_AGENT_PROMPT_PROPERTY]: 'Generic',
            });
            const sent = captureUpdates(entity);

            await new LegacyPromptPropertyMigration().migrateLegacyPromptProperties(entity);

            expect(sent).toHaveLength(1);
            expect(sent[0][EXTRACTOR_PROMPT_TRANSACTIONS_PROPERTY]).toBe('Parser statements');
            expect(sent[0][EXTRACTOR_PROMPT_TRANSACTION_PROPERTY]).toBe('Generic');
            expect(sent[0][EXTRACTOR_PROMPT_FILE_PROPERTY]).toBe('Generic');
            expect(sent[0][LEGACY_AGENT_PROMPT_PROPERTY]).toBe('');
        });

        it('leaves Accounts with only new names or parser URLs untouched', async () => {
            const entity = account({
                [EXTRACTOR_PROMPT_TRANSACTIONS_PROPERTY]: 'Statements',
                [LEGACY_AGENT_PARSER_URL_FILE_PROPERTY]: 'https://parser.example.com/file',
            });
            const sent = captureUpdates(entity);

            await new LegacyPromptPropertyMigration().migrateLegacyPromptProperties(entity);

            expect(sent).toEqual([]);
        });
    });

    describe('prompt lookup without migration (parse API)', () => {
        it('reads an agent_parser_* prompt when the new name is absent and reports where it came from', async () => {
            const entity = account({ [LEGACY_AGENT_PARSER_TRANSACTIONS_PROPERTY]: 'Old statements' });
            book.getAccount = mock(async () => entity);

            const prompt = (await readOnlyLookup().lookupPrompts({ book, file: fileFor('account_1') }))?.getPrompt('transactions');

            expect(prompt?.prompt).toBe('Old statements');
            expect(prompt?.sourceProperty).toBe(LEGACY_AGENT_PARSER_TRANSACTIONS_PROPERTY);
            expect(prompt?.targetProperty).toBe(EXTRACTOR_PROMPT_TRANSACTIONS_PROPERTY);
        });

        it('prefers the new name on the same entity', async () => {
            const entity = account({
                [EXTRACTOR_PROMPT_TRANSACTIONS_PROPERTY]: 'New statements',
                [LEGACY_AGENT_PARSER_TRANSACTIONS_PROPERTY]: 'Old statements',
            });
            book.getAccount = mock(async () => entity);

            const prompt = (await readOnlyLookup().lookupPrompts({ book, file: fileFor('account_1') }))?.getPrompt('transactions');

            expect(prompt?.prompt).toBe('New statements');
            expect(prompt?.sourceProperty).toBe(EXTRACTOR_PROMPT_TRANSACTIONS_PROPERTY);
        });

        it('keeps the Account before its Group whatever name each uses', async () => {
            const entity = account(
                { [LEGACY_AGENT_PARSER_TRANSACTIONS_PROPERTY]: 'Account statements' },
                [group({ [EXTRACTOR_PROMPT_TRANSACTIONS_PROPERTY]: 'Group statements' })]
            );
            book.getAccount = mock(async () => entity);

            const prompt = (await readOnlyLookup().lookupPrompts({ book, file: fileFor('account_1') }))?.getPrompt('transactions');

            expect(prompt?.prompt).toBe('Account statements');
        });

        it('finds transaction-side context through a new-name prompt', async () => {
            const credit = account({ [EXTRACTOR_PROMPT_TRANSACTION_PROPERTY]: 'Invoices' });
            const transaction = { getProperty: () => undefined, getCreditAccount: async () => credit, getDebitAccount: async () => undefined };

            const context = await readOnlyLookup().lookupPrompts({ book, transaction: transaction as never });

            expect(context?.getPrompt('transaction').prompt).toBe('Invoices');
        });
    });

    describe('parser URL lookup', () => {
        it('prefers extractor_url_* and still reads agent_parser_url_* on Accounts, Groups and the Book', async () => {
            const bookWithUrl = new Book({ id: 'book_2', properties: { [LEGACY_AGENT_PARSER_URL_FILE_PROPERTY]: 'https://book.example.com' } });
            bookWithUrl.getAccounts = mock(async () => []);
            const both = account({
                [EXTRACTOR_URL_TRANSACTIONS_PROPERTY]: 'https://new.example.com',
                [LEGACY_AGENT_PARSER_URL_TRANSACTIONS_PROPERTY]: 'https://old.example.com',
            });
            const groupOld = group({ [LEGACY_AGENT_PARSER_URL_TRANSACTIONS_PROPERTY]: 'https://group.example.com' });
            const service = readOnlyLookup();

            expect((await service.lookupTransactionsParserUrl({ book, account: both }))?.url).toBe('https://new.example.com');
            expect((await service.lookupTransactionsParserUrl({ book, group: groupOld }))?.url).toBe('https://group.example.com');
            expect((await service.lookupFileParserUrl({ book: bookWithUrl }))?.url).toBe('https://book.example.com');
        });

        it('keeps the Account before its Group whatever name each uses', async () => {
            const entity = account(
                { [LEGACY_AGENT_PARSER_URL_TRANSACTIONS_PROPERTY]: 'https://account.example.com' },
                [group({ [EXTRACTOR_URL_TRANSACTIONS_PROPERTY]: 'https://group.example.com' })]
            );

            const lookup = await readOnlyLookup().lookupTransactionsParserUrl({ book, account: entity });

            expect(lookup?.url).toBe('https://account.example.com');
        });

        it('never rewrites parser URL properties', async () => {
            const entity = account({ [LEGACY_AGENT_PARSER_URL_FILE_PROPERTY]: 'https://old.example.com' });
            const sent = captureUpdates(entity);

            const lookup = await new PromptLookupService(undefined, false).lookupFileParserUrl({ book, account: entity });

            expect(lookup?.url).toBe('https://old.example.com');
            expect(sent).toEqual([]);
            expect(entity.getProperty(EXTRACTOR_URL_FILE_PROPERTY)).toBeUndefined();
        });
    });

    describe('learning writes', () => {
        it('saves an improved prompt under the new name and deletes the agent_parser_* name in one update', async () => {
            const entity = account({ [LEGACY_AGENT_PARSER_TRANSACTIONS_PROPERTY]: 'Old statements' });
            const sent = captureUpdates(entity);

            await new TestablePromptImprovement().save(entity, EXTRACTOR_PROMPT_TRANSACTIONS_PROPERTY, 'Better statements');

            expect(sent).toEqual([{
                [EXTRACTOR_PROMPT_TRANSACTIONS_PROPERTY]: 'Better statements',
                [LEGACY_AGENT_PARSER_TRANSACTIONS_PROPERTY]: '',
            }]);
        });
    });

    describe('improvement flags', () => {
        it('sets only the new flag', async () => {
            const entity = account({});
            const sent = captureUpdates(entity);

            await new FlagManagementService().setImprovementFlag(entity, new File(book, { id: 'file_1' }));

            expect(sent).toHaveLength(1);
            expect(Object.keys(sent[0])).toEqual([EXTRACTOR_PROMPT_IMPROVE_PROPERTY]);
        });

        it('treats an old flag as already set', async () => {
            const entity = account({ [LEGACY_AGENT_PROMPT_IMPROVE_PROPERTY]: '2026-01-01T00:00:00.000Z' });
            const sent = captureUpdates(entity);

            await new FlagManagementService().setImprovementFlag(entity, new File(book, { id: 'file_1' }));

            expect(sent).toEqual([]);
        });

        it('clears both names of the flag and of the file ID in one update', async () => {
            const entity = account({
                [LEGACY_AGENT_PROMPT_IMPROVE_PROPERTY]: '2026-01-01T00:00:00.000Z',
                [EXTRACTOR_PROMPT_IMPROVE_PROPERTY]: '2026-01-02T00:00:00.000Z',
                [LEGACY_AGENT_FILE_ID_PROPERTY]: 'file_1',
                [EXTRACTOR_FILE_ID_PROPERTY]: 'file_2',
                vendor: 'kept',
            });
            const sent = captureUpdates(entity);

            await new FlagManagementService().clearImprovementFlag(entity);

            expect(sent).toEqual([{
                [LEGACY_AGENT_PROMPT_IMPROVE_PROPERTY]: '',
                [EXTRACTOR_PROMPT_IMPROVE_PROPERTY]: '',
                [LEGACY_AGENT_FILE_ID_PROPERTY]: '',
                [EXTRACTOR_FILE_ID_PROPERTY]: '',
                vendor: 'kept',
            }]);
        });

        it('finds the most recent flag under either name', async () => {
            const oldFlag = new Account(book, { id: 'a', properties: { [LEGACY_AGENT_PROMPT_IMPROVE_PROPERTY]: '2026-01-03T00:00:00.000Z' } });
            const newFlag = new Account(book, { id: 'b', properties: { [EXTRACTOR_PROMPT_IMPROVE_PROPERTY]: '2026-01-02T00:00:00.000Z' } });
            const flaggedBook = new Book({ id: 'book_3' });
            flaggedBook.getAccounts = mock(async () => [newFlag, oldFlag]);
            flaggedBook.getGroups = mock(async () => []);

            expect(await new FlagManagementService().getFlaggedEntity(flaggedBook)).toBe(oldFlag);
        });
    });

    describe('app-owned properties', () => {
        it('are not learned from', () => {
            const service = new TestablePromptImprovement();

            expect(service.skips('extractor_extracted_')).toBe(true);
            expect(service.skips('bookbot_credit_account_id_')).toBe(true);
            expect(service.skips('vendor')).toBe(false);
        });

        it('are dropped from extracted file properties', () => {
            expect(filterFileProperties({
                statement_period: '2024-01',
                extractor_transactions_summary: '[]',
                bookbot_discovered_properties_: 'vendor',
            })).toEqual({ statement_period: '2024-01' });
        });
    });
});
