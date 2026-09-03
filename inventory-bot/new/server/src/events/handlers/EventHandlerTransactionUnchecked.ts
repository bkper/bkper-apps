import type { AppContext } from '../../shared/app-context.js';
import { BotService } from '../services/BotService.js';
import type { EventResult } from '../types.js';

export class EventHandlerTransactionUnchecked {
    protected context: AppContext;
    protected botService: BotService;

    constructor(context: AppContext) {
        this.context = context;
        this.botService = new BotService(context);
    }

    async handleEvent(_event: bkper.Event): Promise<EventResult> {
        return { result: false };
    }
}
