import 'mocha';
import { expect } from 'chai';

import { InterceptorOrderProcessorDeleteFinancial } from '../dist/InterceptorOrderProcessorDeleteFinancial.js';

describe('InterceptorOrderProcessorDeleteFinancial', () => {

    describe('#intercept(financialBook, event)', () => {
        function createEvent(description: string, properties: Record<string, string> = { sale_invoice: 'SALE-001' }) {
            return {
                data: {
                    object: {
                        transaction: {
                            id: 'cogs-1',
                            posted: true,
                            agentId: 'inventory-bot',
                            description,
                            properties,
                            remoteIds: ['sale-1'],
                            debitAccount: { name: 'T-shirts' },
                            creditAccount: { name: 'Cost of goods sold' },
                        },
                    },
                },
            };
        }

        function createInterceptor() {
            const interceptor = new InterceptorOrderProcessorDeleteFinancial();
            const inventoryBookTransaction = { id: 'inventory-sale-1' };

            interceptor.botService = {
                getInventoryBook: () => ({
                    listTransactions: (query: string) => ({
                        getFirst: () => query === 'sale-1' ? inventoryBookTransaction : undefined,
                    }),
                }),
                flagInventoryAccountForRebuild: async (_financialBook: unknown, transaction: unknown) => {
                    return transaction === inventoryBookTransaction ? 'Flagging account for rebuild' : undefined;
                },
            };

            return interceptor;
        }

        it('should flag rebuild when deleting a bot-generated #COGS transaction', async () => {
            const interceptor = createInterceptor();

            const result = await interceptor.intercept({}, createEvent('#COGS Sale'));

            expect(result).to.deep.equal({ result: ['Flagging account for rebuild'] });
        });

        it('should keep supporting the legacy #cost_of_sale marker', async () => {
            const interceptor = createInterceptor();

            const result = await interceptor.intercept({}, createEvent('#cost_of_sale Sale'));

            expect(result).to.deep.equal({ result: ['Flagging account for rebuild'] });
        });

        it('should flag rebuild when quantity_sold identifies the COGS transaction even without a hashtag', async () => {
            const interceptor = createInterceptor();

            const result = await interceptor.intercept({}, createEvent('Calculated by bot', { quantity_sold: '30' }));

            expect(result).to.deep.equal({ result: ['Flagging account for rebuild'] });
        });
    });

});
