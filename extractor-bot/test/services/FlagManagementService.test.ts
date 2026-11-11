import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { FlagManagementService } from '../../src/services/FlagManagementService.js';
import { Account, Group, Book, File } from 'bkper-js';

describe('FlagManagementService', () => {
    let service: FlagManagementService;

    beforeEach(() => {
        service = new FlagManagementService();
    });

    describe('setImprovementFlag', () => {
        it('should set flag with ISO timestamp on account', async () => {
            const mockFile = {
                getId: mock().mockReturnValue('file123'),
            } as unknown as File;

            const mockAccount = {
                getProperty: mock().mockReturnValue(undefined),
                setProperty: mock().mockReturnThis(),
                update: mock().mockResolvedValue(undefined),
            } as unknown as Account;

            // Capture the timestamp that was set
            let capturedTimestamp: string | undefined;
            (mockAccount.setProperty as any).mockImplementation((key: string, value: string) => {
                if (key === 'agent_prompt_improve_') {
                    capturedTimestamp = value;
                }
                return mockAccount;
            });

            await service.setImprovementFlag(mockAccount, mockFile);

            expect(mockAccount.setProperty).toHaveBeenCalledWith('agent_prompt_improve_', expect.any(String));
            expect(mockAccount.update).toHaveBeenCalled();

            // Verify the timestamp is a valid ISO string
            expect(capturedTimestamp).toBeDefined();
            const date = new Date(capturedTimestamp!);
            expect(date.toISOString()).toBe(capturedTimestamp!);
        });

        it('should set flag with ISO timestamp on group', async () => {
            const mockFile = {
                getId: mock().mockReturnValue('file456'),
            } as unknown as File;

            const mockGroup = {
                getProperty: mock().mockReturnValue(undefined),
                setProperty: mock().mockReturnThis(),
                update: mock().mockResolvedValue(undefined),
            } as unknown as Group;

            let capturedTimestamp: string | undefined;
            (mockGroup.setProperty as any).mockImplementation((key: string, value: string) => {
                if (key === 'agent_prompt_improve_') {
                    capturedTimestamp = value;
                }
                return mockGroup;
            });

            await service.setImprovementFlag(mockGroup, mockFile);

            expect(mockGroup.setProperty).toHaveBeenCalledWith('agent_prompt_improve_', expect.any(String));
            expect(mockGroup.update).toHaveBeenCalled();

            expect(capturedTimestamp).toBeDefined();
            const date = new Date(capturedTimestamp!);
            expect(date.toISOString()).toBe(capturedTimestamp!);
        });
    });

    describe('clearImprovementFlag', () => {
        it('should remove flag property from account', async () => {
            const mockAccount = {
                deleteProperty: mock().mockReturnThis(),
                update: mock().mockResolvedValue(undefined),
            } as unknown as Account;

            await service.clearImprovementFlag(mockAccount);

            expect(mockAccount.deleteProperty).toHaveBeenCalledWith('agent_prompt_improve_');
            expect(mockAccount.deleteProperty).toHaveBeenCalledWith('agent_file_id_');
            expect(mockAccount.update).toHaveBeenCalled();
        });

        it('should remove flag property from group', async () => {
            const mockGroup = {
                deleteProperty: mock().mockReturnThis(),
                update: mock().mockResolvedValue(undefined),
            } as unknown as Group;

            await service.clearImprovementFlag(mockGroup);

            expect(mockGroup.deleteProperty).toHaveBeenCalledWith('agent_prompt_improve_');
            expect(mockGroup.deleteProperty).toHaveBeenCalledWith('agent_file_id_');
            expect(mockGroup.update).toHaveBeenCalled();
        });
    });

    describe('getFlaggedEntity', () => {
        it('should return most recently flagged entity when multiple exist', async () => {
            const mockAccount1 = {
                getName: mock().mockReturnValue('Account 1'),
                getProperty: mock().mockReturnValue('2025-01-15T10:00:00.000Z'),
            } as unknown as Account;

            const mockAccount2 = {
                getName: mock().mockReturnValue('Account 2'),
                getProperty: mock().mockReturnValue(undefined), // Not flagged
            } as unknown as Account;

            const mockGroup1 = {
                getName: mock().mockReturnValue('Group 1'),
                getProperty: mock().mockReturnValue('2025-01-15T11:00:00.000Z'), // Most recent
            } as unknown as Group;

            const mockGroup2 = {
                getName: mock().mockReturnValue('Group 2'),
                getProperty: mock().mockReturnValue(undefined), // Not flagged
            } as unknown as Group;

            const mockBook = {
                getAccounts: mock().mockResolvedValue([mockAccount1, mockAccount2]),
                getGroups: mock().mockResolvedValue([mockGroup1, mockGroup2]),
            } as unknown as Book;

            const result = await service.getFlaggedEntity(mockBook);

            // Should return the most recent (Group 1)
            expect(result).toBe(mockGroup1);
        });

        it('should return null when none flagged', async () => {
            const mockAccount = {
                getProperty: mock().mockReturnValue(undefined),
            } as unknown as Account;

            const mockGroup = {
                getProperty: mock().mockReturnValue(undefined),
            } as unknown as Group;

            const mockBook = {
                getAccounts: mock().mockResolvedValue([mockAccount]),
                getGroups: mock().mockResolvedValue([mockGroup]),
            } as unknown as Book;

            const result = await service.getFlaggedEntity(mockBook);

            expect(result).toBeNull();
        });

        it('should handle book with no accounts or groups', async () => {
            const mockBook = {
                getAccounts: mock().mockResolvedValue([]),
                getGroups: mock().mockResolvedValue([]),
            } as unknown as Book;

            const result = await service.getFlaggedEntity(mockBook);

            expect(result).toBeNull();
        });

        it('should return single flagged account when only one exists', async () => {
            const mockAccount1 = {
                getName: mock().mockReturnValue('Account 1'),
                getProperty: mock().mockReturnValue('2025-01-15T10:00:00.000Z'),
            } as unknown as Account;

            const mockBook = {
                getAccounts: mock().mockResolvedValue([mockAccount1]),
                getGroups: mock().mockResolvedValue([]),
            } as unknown as Book;

            const result = await service.getFlaggedEntity(mockBook);

            expect(result).toBe(mockAccount1);
        });

        it('should correctly sort timestamps in descending order (LIFO)', async () => {
            const mockAccount1 = {
                getName: mock().mockReturnValue('Account 1'),
                getProperty: mock().mockReturnValue('2025-01-15T10:00:00.000Z'),
            } as unknown as Account;
            
            const mockAccount2 = {
                getName: mock().mockReturnValue('Account 2'),
                getProperty: mock().mockReturnValue('2025-01-15T10:00:01.000Z'), // 1 second later - most recent
            } as unknown as Account;
            
            const mockAccount3 = {
                getName: mock().mockReturnValue('Account 3'),
                getProperty: mock().mockReturnValue('2025-01-15T09:59:59.000Z'),
            } as unknown as Account;

            const mockBook = {
                getAccounts: mock().mockResolvedValue([mockAccount1, mockAccount2, mockAccount3]),
                getGroups: mock().mockResolvedValue([]),
            } as unknown as Book;

            const result = await service.getFlaggedEntity(mockBook);

            expect(result).toBe(mockAccount2);
        });
    });


});
