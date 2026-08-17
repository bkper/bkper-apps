import { AppContext } from '../../AppContext.js';
import type { EventResultValue } from '../types.js';
import EventHandlerTransactionDeleted from './EventHandlerTransactionDeleted.js';
import EventHandlerTransactionPosted from './EventHandlerTransactionPosted.js';

export default class EventHandlerTransactionUpdated {
    protected context: AppContext;

    constructor(context: AppContext) {
        this.context = context;
    }

    async handleEvent(event: bkper.Event): Promise<EventResultValue> {
        if (
            event.data!.previousAttributes &&
            !event.data!.previousAttributes['dateValue'] &&
            !event.data!.previousAttributes['creditAccId'] &&
            !event.data!.previousAttributes['debitAccId'] &&
            !event.data!.previousAttributes['amount'] &&
            event.data!.previousAttributes['tax_included_amount'] == undefined &&
            event.data!.previousAttributes['tax_excluded_amount'] == undefined
        ) {
            return 'No changes in accounts or amount. Keeping previous calculated taxes.';
        }

        const deletedResult = await new EventHandlerTransactionDeleted(this.context).handleEvent(
            event
        );
        const postedResult = await new EventHandlerTransactionPosted(this.context).handleEvent(
            event
        );

        let result: string[] = [];
        if (deletedResult && Array.isArray(deletedResult) && deletedResult.length > 0) {
            result = result.concat(deletedResult);
        }
        if (postedResult && Array.isArray(postedResult) && postedResult.length > 0) {
            result = result.concat(postedResult);
        }
        return result.length > 0 ? result : false;
    }
}
