import type { AppContext } from '../../app-context.js';
import type { EventResultValue } from '../types.js';

export abstract class EventHandler {
    protected context: AppContext;

    constructor(context: AppContext) {
        this.context = context;
    }

    async handleEvent(event: bkper.Event): Promise<EventResultValue> {
        return false;
    }
}
