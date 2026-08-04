export interface ExchangeRates {
    base: string;
    date?: string;
    error?: boolean;
    message?: string;
    status: number;
    description?: string;
    rates: Record<string, number | string>;
}
