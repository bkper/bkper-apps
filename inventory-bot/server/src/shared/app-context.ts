import { Bkper } from 'bkper-js';
import type { Env } from '../../../env.js';

export class AppContext {
    public bkper: Bkper;
    public env: Env;

    constructor(bkper: Bkper, env: Env) {
        this.bkper = bkper;
        this.env = env;
    }
}
