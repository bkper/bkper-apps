import { AppContext } from '../../AppContext.js';
import type { EventResultValue } from '../types.js';

export default abstract class EventHandler {
    protected context: AppContext;

    constructor(context: AppContext) {
        this.context = context;
    }

    async handleEvent(event: bkper.Event): Promise<EventResultValue> {
        return false;
    }
}
