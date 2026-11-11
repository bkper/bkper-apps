
export interface ExtractedTransaction {
    /** ISO date (YYYY-MM-DD) when explicitly present; null when no clear transaction date exists. */
    date: string | null;
    description: string;
    amount: number;
    properties: {
        [key: string]: string | number;
    };
    /** Optional: Bkper book identifier where the transaction should be recorded; overrides the default book */
    book_id?: string;
    /** Optional: Bkper account name to which the transaction belongs; overrides the default account */
    account_name?: string;
}
