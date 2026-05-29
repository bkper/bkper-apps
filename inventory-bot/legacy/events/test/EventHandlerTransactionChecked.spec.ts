import 'mocha';
import { expect } from 'chai';

import { EventHandlerTransactionChecked } from '../dist/EventHandlerTransactionChecked.js';

describe('EventHandlerTransactionChecked', () => {

    describe('#getTransactionQuery(transaction: bkper.Transaction): string', () => {
        it('should return the remoteId of the sale or purchase transaction in the Inventory Book', () => {

            const transaction = {
                id: '123',
            };

            const query = new EventHandlerTransactionChecked().getTransactionQuery(transaction);

            expect(query).to.equal(`remoteId:123`);
        });
    });

    describe('#connectedTransactionNotFound(inventoryBook, financialTransaction, goodExcCode)', () => {
        it('should return undefined for a credit note without quantity', async () => {

            const transaction = {
                id: '123',
                date: '2024-01-01',
                debitAccount: { name: 'T-shirts' },
                creditAccount: { name: 'Bank' },
                properties: {
                    credit_note: 'CN-001',
                    purchase_code: 'INV-001',
                },
            };

            const result = await new EventHandlerTransactionChecked().connectedTransactionNotFound({}, transaction, 'USD');

            expect(result).to.equal(undefined);
        });

        it('should return undefined for a credit note with zero quantity', async () => {

            const transaction = {
                id: '123',
                date: '2024-01-01',
                debitAccount: { name: 'T-shirts' },
                creditAccount: { name: 'Bank' },
                properties: {
                    credit_note: 'CN-001',
                    purchase_code: 'INV-001',
                    quantity: '0',
                },
            };

            const result = await new EventHandlerTransactionChecked().connectedTransactionNotFound({}, transaction, 'USD');

            expect(result).to.equal(undefined);
        });
    });

});