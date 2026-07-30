import type { AppContext } from '../../app-context.js';
import type { EventHandlerContract, EventHandlerResult } from '../types.js';

export abstract class EventHandler implements EventHandlerContract {
    constructor(protected readonly context: AppContext) {}

    async handleEvent(_event: bkper.Event): Promise<EventHandlerResult> {
        return false;
    }
}
