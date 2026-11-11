import { expect, it, mock } from 'bun:test';
import { Account, Book, File, Group } from 'bkper-js';
import { PromptLookupService } from '../../src/services/PromptLookupService.js';

it('allows prompt and parser URL lookup without migrating or persisting legacy properties', async () => {
    const book = new Book({ id: 'book_1' });
    const group = new Group(book, { id: 'group_1', properties: { agent_prompt: 'Group instructions' } });
    const account = new Account(book, { id: 'account_1', properties: { agent_prompt: 'Account instructions', agent_parser_url_file: 'https://parser.example.com/file' } });
    account.getGroups = mock(async () => [group]);
    account.update = mock(async () => account);
    group.update = mock(async () => group);
    book.getAccount = mock(async () => account);
    book.getAccounts = mock(async () => []);
    const file = new File(book, { properties: { account_id: 'account_1' } });
    const migration = { migrateLegacyPromptProperties: mock(async () => {}) };
    const service = new PromptLookupService(migration);
    const originalAccount = structuredClone(account.json());
    const originalGroup = structuredClone(group.json());

    const prompts = await service.lookupPrompts({ book, file });
    const parser = await service.lookupFileParserUrl({ book, file });

    expect(prompts?.getPrompt('file').prompt).toBe('Account instructions');
    expect(parser?.url).toBe('https://parser.example.com/file');
    expect(migration.migrateLegacyPromptProperties).toHaveBeenCalled();
    expect(account.json()).toEqual(originalAccount);
    expect(group.json()).toEqual(originalGroup);
    expect(account.update).not.toHaveBeenCalled();
    expect(group.update).not.toHaveBeenCalled();
});
