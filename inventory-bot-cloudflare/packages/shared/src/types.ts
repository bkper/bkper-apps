// Entry logged per purchase batch consumed during COGS calculation
export type PurchaseLogEntry = {
	qt: string;
	uc: string;
	id: string;
	rt: string;
};

// Entry logged per sale that liquidates a purchase batch
export type LiquidationLogEntry = {
	id: string;
	dt: string;
	qt: string;
	uc: string;
	rt: string;
};

// Credit note applied against a purchase batch
export type CreditNote = {
	quantity: number;
	amount: number;
};

// Standard result shape returned by event handlers and API routes
export interface EventResult {
	result?: string | string[] | boolean;
	error?: string;
	warning?: string;
}

// Context resolved on the server and sent to the client on init
export interface ContextParams {
	book: { id: string; name: string };
	account?: { id: string; name: string };
	group?: { id: string; name: string };
}
