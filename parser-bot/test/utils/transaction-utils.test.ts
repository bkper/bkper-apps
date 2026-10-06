/// <reference types="@bkper/bkper-api-types" />

import { describe, it, expect } from 'bun:test';
import { Transaction, Account, AccountType, Amount } from 'bkper-js';
import { getAmountSignFromAccountSide } from '../../src/utils/transaction-utils.js';

describe('getAmountSignFromAccountSide', () => {
    /**
     * Helper to create mock Amount
     */
    function createMockAmount(value: number): Amount {
        const negatedAmount = {
            toNumber: () => -value,
            times: () => createMockAmount(value), // negating twice returns to original
        } as unknown as Amount;
        
        return {
            toNumber: () => value,
            times: (multiplier: number) => {
                if (multiplier === -1) {
                    return negatedAmount;
                }
                return createMockAmount(value * multiplier);
            },
        } as unknown as Amount;
    }

    /**
     * Helper to create mock Account
     */
    function createMockAccount(name: string, type: AccountType): Account {
        return {
            getName: () => name,
            getType: () => type,
            getId: () => `${name}-id`,
        } as unknown as Account;
    }

    /**
     * Helper to create mock Transaction with debit/credit accounts and amount
     */
    function createMockTransaction(debitAccount?: Account, creditAccount?: Account, amount: Amount = createMockAmount(100)): Transaction {
        return {
            getDebitAccount: async () => debitAccount,
            getCreditAccount: async () => creditAccount,
            getAmount: () => amount,
        } as unknown as Transaction;
    }

    describe('ASSET accounts', () => {
        it('should return positive amount when ASSET account is on debit side', async () => {
            const assetAccount = createMockAccount('Asset Account', AccountType.ASSET);
            const mockAmount = createMockAmount(100);
            const transaction = createMockTransaction(assetAccount, undefined, mockAmount);
            
            const result = await getAmountSignFromAccountSide(transaction, assetAccount);
            expect(result?.toNumber()).toBe(100);
        });

        it('should return negative amount when ASSET account is on credit side', async () => {
            const assetAccount = createMockAccount('Asset Account', AccountType.ASSET);
            const mockAmount = createMockAmount(100);
            const transaction = createMockTransaction(undefined, assetAccount, mockAmount);
            
            const result = await getAmountSignFromAccountSide(transaction, assetAccount);
            expect(result?.toNumber()).toBe(-100);
        });
    });

    describe('LIABILITY accounts', () => {
        it('should return positive amount when LIABILITY account is on credit side', async () => {
            const liabilityAccount = createMockAccount('Liability Account', AccountType.LIABILITY);
            const mockAmount = createMockAmount(100);
            const transaction = createMockTransaction(undefined, liabilityAccount, mockAmount);
            
            const result = await getAmountSignFromAccountSide(transaction, liabilityAccount);
            expect(result?.toNumber()).toBe(100);
        });

        it('should return negative amount when LIABILITY account is on debit side', async () => {
            const liabilityAccount = createMockAccount('Liability Account', AccountType.LIABILITY);
            const mockAmount = createMockAmount(100);
            const transaction = createMockTransaction(liabilityAccount, undefined, mockAmount);
            
            const result = await getAmountSignFromAccountSide(transaction, liabilityAccount);
            expect(result?.toNumber()).toBe(-100);
        });
    });

    describe('INCOMING accounts', () => {
        it('should return positive amount when INCOMING account is on credit side', async () => {
            const incomingAccount = createMockAccount('Incoming Account', AccountType.INCOMING);
            const mockAmount = createMockAmount(100);
            const transaction = createMockTransaction(undefined, incomingAccount, mockAmount);
            
            const result = await getAmountSignFromAccountSide(transaction, incomingAccount);
            expect(result?.toNumber()).toBe(100);
        });

        it('should return negative amount when INCOMING account is on debit side', async () => {
            const incomingAccount = createMockAccount('Incoming Account', AccountType.INCOMING);
            const mockAmount = createMockAmount(100);
            const transaction = createMockTransaction(incomingAccount, undefined, mockAmount);
            
            const result = await getAmountSignFromAccountSide(transaction, incomingAccount);
            expect(result?.toNumber()).toBe(-100);
        });
    });

    describe('OUTGOING accounts', () => {
        it('should return positive amount when OUTGOING account is on debit side', async () => {
            const outgoingAccount = createMockAccount('Outgoing Account', AccountType.OUTGOING);
            const mockAmount = createMockAmount(100);
            const transaction = createMockTransaction(outgoingAccount, undefined, mockAmount);
            
            const result = await getAmountSignFromAccountSide(transaction, outgoingAccount);
            expect(result?.toNumber()).toBe(100);
        });

        it('should return negative amount when OUTGOING account is on credit side', async () => {
            const outgoingAccount = createMockAccount('Outgoing Account', AccountType.OUTGOING);
            const mockAmount = createMockAmount(100);
            const transaction = createMockTransaction(undefined, outgoingAccount, mockAmount);
            
            const result = await getAmountSignFromAccountSide(transaction, outgoingAccount);
            expect(result?.toNumber()).toBe(-100);
        });
    });

    describe('account not found', () => {
        it('should return transaction amount when account is not on either side', async () => {
            const assetAccount = createMockAccount('Asset Account', AccountType.ASSET);
            const liabilityAccount = createMockAccount('Liability Account', AccountType.LIABILITY);
            const otherAccount = createMockAccount('Other Account', AccountType.ASSET);
            const mockAmount = createMockAmount(100);
            
            const transaction = createMockTransaction(assetAccount, liabilityAccount, mockAmount);
            
            const result = await getAmountSignFromAccountSide(transaction, otherAccount);
            expect(result?.toNumber()).toBe(100);
        });
    });
});
