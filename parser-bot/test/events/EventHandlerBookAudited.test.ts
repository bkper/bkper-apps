/// <reference types="@bkper/bkper-api-types" />

import { describe, it, expect, mock } from 'bun:test';
import { Account, Book } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { EventHandlerBookAudited } from '../../src/events/EventHandlerBookAudited.js';

function createHandler(flagged: Account | null, improvement: string | null): EventHandlerBookAudited {
    const context = {
        flagManagementService: {
            getFlaggedEntity: mock(async () => flagged),
        },
    } as unknown as AppContext;
    const handler = new EventHandlerBookAudited(context);
    Object.assign(handler, {
        statementPromptImprovementService: {
            improveStatementPrompt: mock(async () => improvement),
        },
    });
    return handler;
}

describe('EventHandlerBookAudited', () => {
    it('records no response when no statement is flagged', async () => {
        const result = await createHandler(null, null).handleEvent({} as Book, {});

        expect(result).toEqual({ result: false });
    });

    it('records no response when the flagged statement prompt is not improved', async () => {
        const flagged = new Account({} as Book, { name: 'Bank' });

        const result = await createHandler(flagged, null).handleEvent({} as Book, {});

        expect(result).toEqual({ result: false });
    });
});
