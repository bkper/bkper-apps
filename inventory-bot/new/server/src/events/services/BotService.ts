import type { AppContext } from '../../shared/app-context.js';

export class BotService {
    private context: AppContext;

    constructor(context: AppContext) {
        this.context = context;
    }
}
