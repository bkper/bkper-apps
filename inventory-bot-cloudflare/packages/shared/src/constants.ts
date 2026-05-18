// =============================================================================
// Shared — used by both web handler and events handler
// =============================================================================

// App identity — used to identify transactions created by this bot
export const APP_NAME = 'inventory-bot';

// Book structure — used to locate the inventory and financial books in a collection
export const INVENTORY_BOOK_PROP = 'inventory_book';
export const EXC_CODE_PROP = 'exc_code';

// Transaction classification — used to identify transaction roles during processing
export const CREDIT_NOTE_PROP = 'credit_note';
export const ORDER_PROP = 'order';
export const PURCHASE_CODE_PROP = 'purchase_code';
export const PURCHASE_INVOICE_PROP = 'purchase_invoice';
export const QUANTITY_PROP = 'quantity';
export const SALE_INVOICE_PROP = 'sale_invoice';

// =============================================================================
// Web handler (menu) — COGS calculate and reset operations
// =============================================================================

// Calculation parameters
export const ADDITIONAL_COSTS_CREDITS_QUERY_RANGE = 2; // search window in months
export const COGS_ACCOUNT = 'Cost of goods sold'; // well-known account name in the financial book

// Good account state — track calculation progress and rebuild needs
export const COGS_CALC_DATE_PROP = 'cogs_calc_date';
export const NEEDS_REBUILD_PROP = 'needs_rebuild';

// Purchase batch tracking — store cost and quantity data on inventory transactions
export const ADD_COSTS_PROP = 'additional_costs';
export const GOOD_PURCHASE_COST_PROP = 'good_purchase_cost';
export const LIQUIDATION_LOG_PROP = 'liquidation_log';
export const ORIGINAL_QUANTITY_PROP = 'original_quantity';
export const PARENT_ID = 'parent_id';
export const PURCHASE_LOG_PROP = 'purchase_log';
export const TOTAL_COST_PROP = 'total_cost';

// Financial book output — written to COGS transactions in the financial book
export const QUANTITY_SOLD_PROP = 'quantity_sold';

// =============================================================================
// Events handler — transaction interception and cost-of-sale posting
// =============================================================================

// Cost of sale amount written to financial transactions during event processing
export const COST_OF_SALE_PROP = 'cost_of_sale';
