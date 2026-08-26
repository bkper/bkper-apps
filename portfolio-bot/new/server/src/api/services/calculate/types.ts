/** The calculation behavior configured on the Portfolio Book. */
export enum CalculationModel {
    /** Calculate results using historical values. */
    HISTORICAL_ONLY = 'historical',
    /** Calculate results using fair values. */
    FAIR_ONLY = 'fair',
    /** Calculate both historical and fair-value results. */
    BOTH = 'both',
}

/** A purchase lot recorded in a Portfolio Transaction property. */
export interface PurchaseLogEntry {
    /** Purchased quantity. */
    qt: string;
    /** Purchase price. */
    pr: string;
    /** Purchase date. */
    dt: string;
    /** Purchase exchange rate. */
    rt: string;
}

/** A sale liquidation recorded in a Portfolio Transaction property. */
export interface LiquidationLogEntry {
    /** Source Transaction id. */
    id: string;
    /** Liquidation date. */
    dt: string;
    /** Liquidated quantity. */
    qt: string;
    /** Liquidation price. */
    pr: string;
    /** Liquidation exchange rate. */
    rt: string;
}
