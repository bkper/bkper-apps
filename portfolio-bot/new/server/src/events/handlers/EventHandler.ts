import type { AppContext } from '../../shared/app-context.js';
import type { EventResult } from '../types.js';

export abstract class EventHandler {
    protected context: AppContext;

    constructor(context: AppContext) {
        this.context = context;
    }

    async handleEvent(_event: bkper.Event): Promise<EventResult> {
        return { result: false };
    }
}
