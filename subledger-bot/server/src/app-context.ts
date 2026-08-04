import { Bkper } from 'bkper-js';

export class AppContext {
    public bkper: Bkper;

    constructor(bkper: Bkper) {
        this.bkper = bkper;
    }
}
