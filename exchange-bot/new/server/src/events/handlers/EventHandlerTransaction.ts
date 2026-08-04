import type { Amount } from 'bkper-js';
import type { ExchangeRates } from '../../ExchangeRates.js';
import { EventHandler } from './EventHandler.js';

export interface AmountDescription {
    amount: Amount;
    description: string;
    excBaseCode: string;
    excBaseRate?: Amount;
    rates?: ExchangeRates;
}

export interface ExcLogEntry {
    exc_code: string;
    exc_rate: string;
}

export abstract class EventHandlerTransaction extends EventHandler {}
