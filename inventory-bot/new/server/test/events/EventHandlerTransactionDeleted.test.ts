import { afterEach, describe, expect, test } from 'bun:test';
import { Bkper } from 'bkper-js';
import { EventHandlerTransactionDeleted } from '../../src/events/handlers/EventHandlerTransactionDeleted.js';
import { InterceptorOrderProcessorDeleteFinancial } from '../../src/events/interceptors/InterceptorOrderProcessorDeleteFinancial.js';
import { InterceptorOrderProcessorDeleteGoods } from '../../src/events/interceptors/InterceptorOrderProcessorDeleteGoods.js';
import { AppContext } from '../../src/shared/app-context.js';

const originalFinancialDeleteIntercept =
    InterceptorOrderProcessorDeleteFinancial.prototype.intercept;
const originalGoodsDeleteIntercept = InterceptorOrderProcessorDeleteGoods.prototype.intercept;

afterEach(() => {
    InterceptorOrderProcessorDeleteFinancial.prototype.intercept = originalFinancialDeleteIntercept;
    InterceptorOrderProcessorDeleteGoods.prototype.intercept = originalGoodsDeleteIntercept;
});

function createEvent(inventory: boolean): bkper.Event {
    return {
        type: 'TRANSACTION_DELETED',
        book: {
            id: inventory ? 'inventory' : 'financial',
            name: inventory ? 'Inventory' : 'Financial',
            properties: inventory ? { inventory_book: 'true' } : { exc_code: 'USD' },
        },
        agent: { id: 'user' },
        user: { username: 'tester' },
        data: { object: {} },
    };
}

describe('legacy transaction deleted handler', () => {
    test('selects Inventory or Financial deletion behavior from the event Book', async () => {
        const calls: string[] = [];
        InterceptorOrderProcessorDeleteGoods.prototype.intercept = async () => {
            calls.push('inventory');
            return { result: 'inventory-deleted' };
        };
        InterceptorOrderProcessorDeleteFinancial.prototype.intercept = async () => {
            calls.push('financial');
            return { result: 'financial-deleted' };
        };

        const handler = new EventHandlerTransactionDeleted(
            new AppContext(new Bkper(), { ASSETS: { fetch } })
        );
        const inventoryResult = await handler.handleEvent(createEvent(true));
        const financialResult = await handler.handleEvent(createEvent(false));

        expect(calls).toEqual(['inventory', 'financial']);
        expect(inventoryResult).toEqual({ result: 'inventory-deleted' });
        expect(financialResult).toEqual({ result: 'financial-deleted' });
    });
});
