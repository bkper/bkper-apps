type PurchaseLogEntry = {
	qt: string,
	uc: string,
	id: string,
	rt: string,
}

type LiquidationLogEntry = {
    id: string;
    dt: string;
    qt: string;
    uc: string;
    rt: string;
}

type CreditNote = {
    quantity: number,
    amount: Bkper.Amount
}