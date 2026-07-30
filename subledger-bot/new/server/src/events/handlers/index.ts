import type { AppContext } from '../../app-context.js';
import type { EventHandlerMap } from '../types.js';
import { EventHandlerAccountCreatedOrUpdated } from './EventHandlerAccountCreatedOrUpdated.js';
import { EventHandlerAccountDeleted } from './EventHandlerAccountDeleted.js';
import { EventHandlerGroupCreatedOrUpdated } from './EventHandlerGroupCreatedOrUpdated.js';
import { EventHandlerGroupDeleted } from './EventHandlerGroupDeleted.js';
import { EventHandlerTransactionChecked } from './EventHandlerTransactionChecked.js';
import { EventHandlerTransactionDeleted } from './EventHandlerTransactionDeleted.js';
import { EventHandlerTransactionPosted } from './EventHandlerTransactionPosted.js';
import { EventHandlerTransactionRestored } from './EventHandlerTransactionRestored.js';
import { EventHandlerTransactionUpdated } from './EventHandlerTransactionUpdated.js';

export type EventHandlerMapFactory = (context: AppContext) => EventHandlerMap;

export function createEventHandlerMap(context: AppContext): EventHandlerMap {
    const accountCreatedOrUpdated = new EventHandlerAccountCreatedOrUpdated(context);
    const groupCreatedOrUpdated = new EventHandlerGroupCreatedOrUpdated(context);

    return {
        TRANSACTION_POSTED: new EventHandlerTransactionPosted(context),
        TRANSACTION_CHECKED: new EventHandlerTransactionChecked(context),
        TRANSACTION_UPDATED: new EventHandlerTransactionUpdated(context),
        TRANSACTION_DELETED: new EventHandlerTransactionDeleted(context),
        TRANSACTION_RESTORED: new EventHandlerTransactionRestored(context),
        ACCOUNT_CREATED: accountCreatedOrUpdated,
        ACCOUNT_UPDATED: accountCreatedOrUpdated,
        ACCOUNT_DELETED: new EventHandlerAccountDeleted(context),
        GROUP_CREATED: groupCreatedOrUpdated,
        GROUP_UPDATED: groupCreatedOrUpdated,
        GROUP_DELETED: new EventHandlerGroupDeleted(context),
    };
}
