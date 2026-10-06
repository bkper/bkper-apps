/// <reference types="@bkper/bkper-api-types" />

import { describe, it, expect, mock } from 'bun:test';
import { Book, Transaction } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { AGENT_FILE_ID_PROPERTY } from '../../src/constants.js';
import { EventHandlerTransactionDeleted } from '../../src/events/EventHandlerTransactionDeleted.js';

function createHandler(flagStatementForImprovement: (book: Book, transaction: Transaction) => Promise<string | null>): EventHandlerTransactionDeleted {
    const handler = new EventHandlerTransactionDeleted({} as AppContext);
    Object.assign(handler, {
        statementPromptImprovementService: {
            flagStatementForImprovement,
        },
    });
    return handler;
}

describe('EventHandlerTransactionDeleted', () => {
    it('uses the transaction payload from the event instead of loading the deleted transaction by id', async () => {
        let capturedTransaction: Transaction | undefined;
        const flagStatementForImprovement = mock(async (_book: Book, transaction: Transaction): Promise<string | null> => {
            capturedTransaction = transaction;
            return 'Prompt flagged for improvement: Bank';
        });
        const getTransaction = mock(async () => undefined);
        const book = {
            getTransaction,
        } as unknown as Book;
        const event: bkper.Event = {
            data: {
                object: {
                    transaction: {
                        id: 'tx_1',
                        date: '2026-01-15',
                        description: 'Statement transaction',
                        amount: '42.00',
                        trashed: false,
                        properties: {
                            [AGENT_FILE_ID_PROPERTY]: 'file_1',
                        },
                    },
                } as bkper.TransactionOperation,
            },
        };

        const result = await createHandler(flagStatementForImprovement).handleEvent(book, event);

        expect(getTransaction).not.toHaveBeenCalled();
        expect(flagStatementForImprovement).toHaveBeenCalledTimes(1);
        expect(capturedTransaction?.getId()).toBe('tx_1');
        expect(capturedTransaction?.getProperty(AGENT_FILE_ID_PROPERTY)).toBe('file_1');
        expect(capturedTransaction?.isTrashed()).toBe(true);
        expect(result).toEqual({ result: 'Statement flagged for improvement after transaction deletion' });
    });

    it('does not call the flagging service when the event has no transaction id', async () => {
        const flagStatementForImprovement = mock(async (): Promise<string | null> => 'should not happen');
        const book = {} as Book;
        const event: bkper.Event = {
            data: {
                object: {
                    transaction: {
                        properties: {
                            [AGENT_FILE_ID_PROPERTY]: 'file_1',
                        },
                    },
                } as bkper.TransactionOperation,
            },
        };

        const result = await createHandler(flagStatementForImprovement).handleEvent(book, event);

        expect(flagStatementForImprovement).not.toHaveBeenCalled();
        expect(result).toEqual({ result: 'No transaction ID in event' });
    });
});
