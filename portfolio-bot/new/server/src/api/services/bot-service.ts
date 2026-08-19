import type { AppContext } from '../../shared/app-context.js';

interface RatesEndpointConfig {
    url: string;
}

export class BotService {
    private context: AppContext;

    constructor(context: AppContext) {
        this.context = context;
    }
}
