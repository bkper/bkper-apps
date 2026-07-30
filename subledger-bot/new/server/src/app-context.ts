import { Bkper } from 'bkper-js';

export class AppContext {
    constructor(readonly bkper: Bkper) {}
}

export type AppContextFactory = () => AppContext;

export function createAppContext(): AppContext {
    return new AppContext(new Bkper());
}
