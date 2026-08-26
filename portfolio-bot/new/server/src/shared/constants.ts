// App identity
export const APP_ID = 'stock-bot';
export const STOCK_BOT_AGENT_ID = 'stock-bot';

// Book properties
export const STOCK_BOOK_PROP = 'stock_book';
export const STOCK_HISTORICAL_PROP = 'stock_historical';
export const STOCK_FAIR_PROP = 'stock_fair';
export const EXC_BASE_PROP = 'exc_base';
export const EXC_CODE_PROP = 'exc_code';
export const EXC_HISTORICAL_PROP = 'exc_historical';
export const EXC_AGGREGATE_PROP = 'exc_aggregate';

// Group properties
export const STOCK_EXC_CODE_PROP = 'stock_exc_code';
export const EXC_ACCOUNT_PROP = 'exc_account';

// Account properties
export const STOCK_FEES_ACCOUNT_PROP = 'stock_fees_account';
export const NEEDS_REBUILD_PROP = 'needs_rebuild';
export const LEGACY_REALIZED_DATE_PROP = 'stock_realized_date';
export const REALIZED_DATE_PROP = 'realized_date';
export const FORWARDED_DATE_PROP = 'forwarded_date';
export const FORWARDED_PRICE_PROP = 'forwarded_price';
export const FORWARDED_EXC_RATE_PROP = 'forwarded_exc_rate';

// Portfolio Account names
export const STOCK_BUY_ACCOUNT_NAME = 'Buy';
export const STOCK_SELL_ACCOUNT_NAME = 'Sell';

// Trade properties
export const TRADE_DATE_PROP = 'trade_date';
export const SETTLEMENT_DATE = 'settlement_date';
export const INSTRUMENT_PROP = 'instrument';
export const QUANTITY_PROP = 'quantity';
export const FEES_PROP = 'fees';
export const INTEREST_PROP = 'interest';
export const PRICE_PROP = 'price';
export const PRICE_HIST_PROP = 'price_hist';
export const TRADE_EXC_RATE_PROP = 'trade_exc_rate';
export const TRADE_EXC_RATE_HIST_PROP = 'trade_exc_rate_hist';
export const ORDER_PROP = 'order';

// Original and historical trade state
export const ORIGINAL_QUANTITY_PROP = 'original_quantity';
export const HIST_QUANTITY_PROP = 'hist_quantity';
export const OPEN_QUANTITY_PROP = 'open_quantity';
export const ORIGINAL_AMOUNT_PROP = 'original_amount';
export const HIST_ORDER_PROP = 'hist_order';
export const DATE_PROP = 'date';

// Purchase calculation state
export const PURCHASE_PRICE_PROP = 'purchase_price';
export const PURCHASE_PRICE_HIST_PROP = 'purchase_price_hist';
export const FWD_PURCHASE_PRICE_PROP = 'fwd_purchase_price';
export const PURCHASE_AMOUNT_PROP = 'purchase_amount';
export const FWD_PURCHASE_AMOUNT_PROP = 'fwd_purchase_amount';
export const PURCHASE_EXC_RATE_PROP = 'purchase_exc_rate';
export const FWD_PURCHASE_EXC_RATE_PROP = 'fwd_purchase_exc_rate';
export const PURCHASE_LOG_PROP = 'purchase_log';
export const FWD_PURCHASE_LOG_PROP = 'fwd_purchase_log';

// Sale calculation state
export const SALE_PRICE_PROP = 'sale_price';
export const SALE_PRICE_HIST_PROP = 'sale_price_hist';
export const FWD_SALE_PRICE_PROP = 'fwd_sale_price';
export const SALE_AMOUNT_PROP = 'sale_amount';
export const FWD_SALE_AMOUNT_PROP = 'fwd_sale_amount';
export const SALE_EXC_RATE_PROP = 'sale_exc_rate';
export const FWD_SALE_EXC_RATE_PROP = 'fwd_sale_exc_rate';
export const SALE_DATE_PROP = 'sale_date';

// Result calculation and Reset state
export const COST_HIST_PROP = 'cost_hist';
export const COST_BASE_PROP = 'cost_base';
export const COST_HIST_BASE_PROP = 'cost_hist_base';
export const SHORT_SALE_PROP = 'short_sale';
export const GAIN_AMOUNT_PROP = 'gain_amount';
export const GAIN_AMOUNT_HIST_PROP = 'gain_amount_hist';
export const EXC_RATE_PROP = 'exc_rate';
export const LIQUIDATION_LOG_PROP = 'liquidation_log';
export const EXC_AMOUNT_PROP = 'exc_amount';

// Result Account suffixes
export const UNREALIZED_SUFFIX = 'Unrealized';
export const UNREALIZED_HIST_SUFFIX = 'Unrealized Hist';
export const UNREALIZED_EXC_SUFFIX = 'Unrealized EXC';
export const UNREALIZED_HIST_EXC_SUFFIX = 'Unrealized Hist EXC';
export const REALIZED_SUFFIX = 'Realized';
export const REALIZED_HIST_SUFFIX = 'Realized Hist';
export const REALIZED_EXC_SUFFIX = 'Realized EXC';
export const REALIZED_HIST_EXC_SUFFIX = 'Realized Hist EXC';
export const MTM_SUFFIX = 'MTM';

// Forward transaction state
export const FWD_TX_PROP = 'fwd_tx';
export const FWD_LIQUIDATION_PROP = 'fwd_liquidation';
export const FWD_LOG_PROP = 'fwd_log';

// Linked movement identifiers
export const FX_PREFIX = 'fx_';
export const PARENT_ID = 'parent_id';

// Result hashtags
export const STOCK_GAIN_HASHTAG = '#stock_gain';
export const STOCK_LOSS_HASHTAG = '#stock_loss';
export const EXCHANGE_GAIN_HASHTAG = '#exchange_gain';
export const EXCHANGE_LOSS_HASHTAG = '#exchange_loss';

// Other configuration
export const MAX_DECIMAL_PLACES = 8;
