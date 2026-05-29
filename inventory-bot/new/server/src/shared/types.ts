// =============================================================================
// Shared — used by both web handler and events handler
// =============================================================================

// Standard result shape returned by event handlers and API routes
export interface EventResult {
	result?: string | string[] | boolean;
	error?: string;
	warning?: string;
}

// =============================================================================
// Web handler (menu) — COGS calculate and reset operations
// =============================================================================

// Context resolved by the server on menu open and sent to the client on init
export interface ContextParams {
	book: { id: string; name: string };
	account?: { id: string; name: string };
	group?: { id: string; name: string };
}

// Entry logged per purchase batch consumed when matching a sale in FIFO order
export type PurchaseLogEntry = {
	id: string;
	qt: string; // quantity consumed
	uc: string; // unit cost
	rt: string; // exchange rate (if applicable)
};

// Entry logged on a purchase batch recording which sale liquidated it
export type LiquidationLogEntry = {
	id: string; // sale transaction id
	dt: string; // sale date
	qt: string; // quantity sold
	uc: string; // unit cost at liquidation
	rt: string; // exchange rate (if applicable)
};

// Credit note adjustment applied against a purchase batch before FIFO matching
export type CreditNote = {
	quantity: number; // quantity reversed
	amount: number;   // credit amount
};
