BkperApp.setApiKey(PropertiesService.getScriptProperties().getProperty('API_KEY'));
BkperApp.setAgentId('stock-bot');

const STOCK_BOOK_PROP = 'stock_book';
const STOCK_EXC_CODE_PROP = 'stock_exc_code';
const STOCK_FEES_ACCOUNT_PROP = 'stock_fees_account';
const TRADE_DATE_PROP = 'trade_date';
const INSTRUMENT_PROP = 'instrument';
// const QUANTITY_PROP = 'quantity';
const OPEN_QUANTITY_PROP = 'open_quantity';
const HIST_QUANTITY_PROP = 'hist_quantity';
const FEES_PROP = 'fees';
const INTEREST_PROP = 'interest';
const NEEDS_REBUILD_PROP = 'needs_rebuild';
const PRICE_PROP = 'price'
const PURCHASE_PRICE_HIST_PROP = 'purchase_price_hist';
const PURCHASE_PRICE_PROP = 'purchase_price';
const FWD_PURCHASE_PRICE_PROP = 'fwd_purchase_price';
const PURCHASE_AMOUNT_PROP = 'purchase_amount';
const FWD_PURCHASE_AMOUNT_PROP = 'fwd_purchase_amount';
const PURCHASE_QUANTITY_PROP = 'purchase_quantity';
const PARENT_ID = 'parent_id'
const SHORT_SALE_PROP = 'short_sale';
const GAIN_AMOUNT_HIST_PROP = 'gain_amount_hist';
const GAIN_AMOUNT_PROP = 'gain_amount';
const PURCHASE_LOG_PROP = 'purchase_log';
const FWD_PURCHASE_LOG_PROP = 'fwd_purchase_log';
const LIQUIDATION_LOG_PROP = 'liquidation_log';
const ORIGINAL_QUANTITY_PROP = 'original_quantity';
const ORIGINAL_AMOUNT_PROP = 'original_amount';
const SALE_PRICE_HIST_PROP = 'sale_price_hist';
const SALE_PRICE_PROP = 'sale_price';
const FWD_SALE_PRICE_PROP = 'fwd_sale_price';
const SALE_AMOUNT_PROP = 'sale_amount';
const FWD_SALE_AMOUNT_PROP = 'fwd_sale_amount';
const SALE_DATE_PROP = 'sale_date';
const EXC_CODE_PROP = 'exc_code';
const EXC_BASE_PROP = 'exc_base';
const EXC_RATE_PROP = 'exc_rate';
const EXC_AMOUNT_PROP = 'exc_amount';
const EXC_ACCOUNT_PROP = 'exc_account';
const EXC_AGGREGATE_PROP = 'exc_aggregate';
const PURCHASE_EXC_RATE_PROP = 'purchase_exc_rate';
const FWD_PURCHASE_EXC_RATE_PROP = 'fwd_purchase_exc_rate';
const SALE_EXC_RATE_PROP = 'sale_exc_rate';
const FWD_SALE_EXC_RATE_PROP = 'fwd_sale_exc_rate';
const ORDER_PROP = 'order';
const HIST_ORDER_PROP = 'hist_order';
const STOCK_HISTORICAL_PROP = 'stock_historical';
const STOCK_FAIR_PROP = 'stock_fair';
const DATE_PROP = 'date';
const REALIZED_DATE_PROP = 'realized_date';
const LEGACY_REALIZED_DATE_PROP = 'stock_realized_date';
const FORWARDED_DATE_PROP = 'forwarded_date';
const FORWARDED_PRICE_PROP = 'forwarded_price';
const FORWARDED_EXC_RATE_PROP = 'forwarded_exc_rate';
const STOCK_SELL_ACCOUNT_NAME = 'Sell';
const STOCK_BUY_ACCOUNT_NAME = 'Buy';
const QUANTITY_PROP = 'quantity';
const SELL_ACCOUNT_NAME = 'Sell'
const BUY_ACCOUNT_NAME = 'Buy'
const ORIGINAL_PURCHASE_PRICE = 'orig_purchase_price'
const ORIGINAL_SALE_PRICE = 'orig_sale_price'
const TRADE_EXC_RATE_PROP = 'trade_exc_rate';
const TRADE_EXC_RATE_HIST_PROP = 'trade_exc_rate_hist';

// Account suffixes
const UNREALIZED_SUFFIX = 'Unrealized';
const UNREALIZED_HIST_SUFFIX = 'Unrealized Hist';
const UNREALIZED_EXC_SUFFIX = 'Unrealized EXC';
const UNREALIZED_HIST_EXC_SUFFIX = 'Unrealized Hist EXC';

const REALIZED_SUFFIX = 'Realized';
const REALIZED_HIST_SUFFIX = 'Realized Hist';
const REALIZED_EXC_SUFFIX = 'Realized EXC';
const REALIZED_HIST_EXC_SUFFIX = 'Realized Hist EXC';

const FORWARDED_SUFFIX = 'Forwarded';

const MTM_SUFFIX = 'MTM';

// Forward fix new props
const FWD_TX_PROP = 'fwd_tx';
const FWD_TX_REMOTE_IDS_PROP = 'fwd_tx_remote_ids';
const FWD_LIQUIDATION_PROP = 'fwd_liquidation';
const FWD_LOG_PROP = 'fwd_log';

// Max supported decimal places
const MAX_DECIMAL_PLACES = 8;


function doGet(e: GoogleAppsScript.Events.AppsScriptHttpRequestEvent) {

  // @ts-ignore
  let bookId = e.parameter.bookId;
  // @ts-ignore
  let accountId = e.parameter.accountId;
  // @ts-ignore
  let groupId = e.parameter.groupId;

  return BotViewService.getBotViewTemplate(bookId, accountId, groupId);
}

function validate(bookId: string): void {
  // Check if Stock Book has pending tasks
  const book = BkperApp.getBook(bookId);
  const stockBook = BotService.getStockBook(book);
  if (BotService.hasPendingTasks(stockBook)) {
    throw `Cannot start operation: Stock Book has pending tasks`;
  }
}

function calculateRealizedResults(bookId: string, accountId: string, autoMtM: boolean, toDate: string): Summary {

  // Log user inputs
  console.log(`book id: ${bookId}, account id: ${accountId}, date input: ${toDate}, autoMtM: ${autoMtM}`);

  if (accountId) {
    const summary = RealizedResultsService.calculateRealizedResultsForAccountAsync(bookId, accountId, autoMtM, toDate);
    return summary.json();
  }

}

function resetRealizedResults(bookId: string, accountId: string): Summary {

  // Log user inputs
  console.log(`book id: ${bookId}, account id: ${accountId}`);

  if (accountId) {
    const summary = RealizedResultsService.resetRealizedResults(bookId, accountId, false);
    return summary.json();
  }

}

function fullResetRealizedResults(bookId: string, accountId: string): Summary {

  // Log user inputs
  console.log(`book id: ${bookId}, account id: ${accountId}`);

  if (accountId) {
    const summary = RealizedResultsService.resetRealizedResults(bookId, accountId, true);
    return summary.json();
  }

}

function setForwardDate(bookId: string, accountId: string, date: string): Summary {

  // Log user inputs
  console.log(`book id: ${bookId}, account id: ${accountId}, date input: ${date}`);

  if (accountId) {
    const summary = ForwardDateService.forwardDate(bookId, accountId, date);
    return summary.json();
  }

}
