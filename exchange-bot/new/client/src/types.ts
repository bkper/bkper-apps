/** A Bkper Book with the context needed by the Exchange Bot client. */
export interface ExchangeBotBook {
    /** The unique identifier of the Book. */
    id: string;
    /** The currency code configured for the Book, when available. */
    code: string | undefined;
    /** Whether Exchange Update should run for this Book. */
    isBase: boolean;
    /** The number of decimal places supported by the Book. */
    fractionDigits?: number;
}
