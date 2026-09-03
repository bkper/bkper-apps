import type { AppContext } from '../../shared/app-context.js';
import { BotService } from '../services/BotService.js';
import type { EventResult } from '../types.js';

export class EventHandlerTransactionPosted {
    protected botService: BotService;
    protected context: AppContext;

    constructor(context: AppContext) {
        this.context = context;
        this.botService = new BotService(context);
    }

    async handleEvent(_event: bkper.Event): Promise<EventResult> {
        return { result: false };
    }
}
