import { describe, it, expect, mock } from 'bun:test';
import { Account, Group } from 'bkper-js';
import { PromptImprovementServiceBase, JaroWinklerStringComparator } from '../../src/services/PromptImprovementServiceBase.js';
import { AGENT_PARSER_TRANSACTIONS_PROPERTY } from '../../src/constants.js';

/**
 * Test subclass to expose protected methods for testing
 */
class TestablePromptImprovementServiceBase extends PromptImprovementServiceBase {
    constructor() {
        super(new JaroWinklerStringComparator());
    }

    public testShouldSkipProperty(key: string, userDefinedSkipKeys?: string[]): boolean {
        return this.shouldSkipProperty(key, userDefinedSkipKeys);
    }

    public async testSaveImprovedPrompt(entity: Account | Group | undefined, promptProperty: string, improvedPrompt: string, reasoning: string): Promise<string | null> {
        return this.saveImprovedPrompt(entity, promptProperty, improvedPrompt, reasoning);
    }
}

describe('PromptImprovementServiceBase.shouldSkipProperty', () => {
    const service = new TestablePromptImprovementServiceBase();

    describe('saveImprovedPrompt', () => {
        it('should write improved prompts to the provided purpose-specific property', async () => {
            const account = {
                getName: () => 'Bank',
                setProperty: mock(),
                update: mock().mockResolvedValue(undefined),
            } as unknown as Account;

            await service.testSaveImprovedPrompt(account, AGENT_PARSER_TRANSACTIONS_PROPERTY, 'Improved prompt', 'Because tests');

            expect(account.setProperty).toHaveBeenCalledWith(AGENT_PARSER_TRANSACTIONS_PROPERTY, 'Improved prompt');
            expect(account.setProperty).not.toHaveBeenCalledWith('agent_prompt', 'Improved prompt');
        });
    });

    describe('hardcoded SKIP_PROPERTIES (prefix matching - existing behavior)', () => {
        it('should skip properties starting with "agent_"', () => {
            expect(service.testShouldSkipProperty('agent_extracted')).toBe(true);
            expect(service.testShouldSkipProperty('agent_prompt')).toBe(true);
            expect(service.testShouldSkipProperty('agent_file_id')).toBe(true);
        });

        it('should skip properties starting with "parsed_"', () => {
            expect(service.testShouldSkipProperty('parsed_date')).toBe(true);
            expect(service.testShouldSkipProperty('parsed_account_name')).toBe(true);
        });

        it('should skip properties starting with "account_id"', () => {
            expect(service.testShouldSkipProperty('account_id')).toBe(true);
            expect(service.testShouldSkipProperty('account_id_123')).toBe(true);
        });

        it('should skip properties starting with "group_id"', () => {
            expect(service.testShouldSkipProperty('group_id')).toBe(true);
            expect(service.testShouldSkipProperty('group_id_456')).toBe(true);
        });

        it('should skip properties starting with "upload_method"', () => {
            expect(service.testShouldSkipProperty('upload_method')).toBe(true);
            expect(service.testShouldSkipProperty('upload_method_api')).toBe(true);
        });

        it('should skip properties starting with "auto_filled_date_"', () => {
            expect(service.testShouldSkipProperty('auto_filled_date_')).toBe(true);
            expect(service.testShouldSkipProperty('auto_filled_date_2025')).toBe(true);
        });

        it('should NOT skip regular user properties', () => {
            expect(service.testShouldSkipProperty('vendor')).toBe(false);
            expect(service.testShouldSkipProperty('invoice_number')).toBe(false);
            expect(service.testShouldSkipProperty('category')).toBe(false);
            expect(service.testShouldSkipProperty('notes')).toBe(false);
        });
    });

    describe('user-defined skip keys (exact matching)', () => {
        it('should skip user-defined keys with exact match', () => {
            const userSkipKeys = ['custom_field', 'internal_notes'];

            expect(service.testShouldSkipProperty('custom_field', userSkipKeys)).toBe(true);
            expect(service.testShouldSkipProperty('internal_notes', userSkipKeys)).toBe(true);
        });

        it('should NOT skip properties that only start with user-defined keys (no prefix matching)', () => {
            const userSkipKeys = ['custom'];

            // Exact match should work
            expect(service.testShouldSkipProperty('custom', userSkipKeys)).toBe(true);

            // Prefix match should NOT work for user-defined keys
            expect(service.testShouldSkipProperty('custom_field', userSkipKeys)).toBe(false);
            expect(service.testShouldSkipProperty('custom_notes', userSkipKeys)).toBe(false);
        });

        it('should handle empty user-defined skip keys array', () => {
            expect(service.testShouldSkipProperty('vendor', [])).toBe(false);
            expect(service.testShouldSkipProperty('custom_field', [])).toBe(false);
        });

        it('should handle undefined user-defined skip keys', () => {
            expect(service.testShouldSkipProperty('vendor', undefined)).toBe(false);
            expect(service.testShouldSkipProperty('custom_field', undefined)).toBe(false);
        });

        it('should combine hardcoded and user-defined skip keys', () => {
            const userSkipKeys = ['my_internal_field', 'temp_data'];

            // Hardcoded should still work (prefix matching)
            expect(service.testShouldSkipProperty('agent_extracted', userSkipKeys)).toBe(true);
            expect(service.testShouldSkipProperty('parsed_date', userSkipKeys)).toBe(true);

            // User-defined should work (exact matching)
            expect(service.testShouldSkipProperty('my_internal_field', userSkipKeys)).toBe(true);
            expect(service.testShouldSkipProperty('temp_data', userSkipKeys)).toBe(true);

            // Regular properties should NOT be skipped
            expect(service.testShouldSkipProperty('vendor', userSkipKeys)).toBe(false);
        });

        it('should be case-insensitive for user-defined keys', () => {
            const userSkipKeys = ['CustomField'];

            expect(service.testShouldSkipProperty('CustomField', userSkipKeys)).toBe(true);
            expect(service.testShouldSkipProperty('customfield', userSkipKeys)).toBe(true);
            expect(service.testShouldSkipProperty('CUSTOMFIELD', userSkipKeys)).toBe(true);
        });

        it('should handle whitespace in user-defined keys', () => {
            // User-defined keys should be trimmed before comparison
            const userSkipKeys = ['  my_field  ', 'other_field'];

            expect(service.testShouldSkipProperty('my_field', userSkipKeys)).toBe(true);
            expect(service.testShouldSkipProperty('other_field', userSkipKeys)).toBe(true);
        });
    });

    describe('edge cases', () => {
        it('should handle empty string key', () => {
            expect(service.testShouldSkipProperty('')).toBe(false);
            expect(service.testShouldSkipProperty('', [''])).toBe(true);
        });

        it('should handle user-defined key that looks like hardcoded prefix', () => {
            // User wants to skip exact "agent" but not "agent_extracted"
            const userSkipKeys = ['agent'];

            // "agent" exact match
            expect(service.testShouldSkipProperty('agent', userSkipKeys)).toBe(true);

            // "agent_extracted" should match hardcoded prefix, not user-defined exact
            expect(service.testShouldSkipProperty('agent_extracted', userSkipKeys)).toBe(true);
        });
    });
});
