// =============================================================================
// Web handler (menu) — COGS calculate and reset operations
// =============================================================================

// Builds a Bkper transaction query for a specific account with optional date bounds
export function getAccountQuery(accountName: string, beforeDate?: string, afterDate?: string): string {
	let query = `account:'${accountName}'`;
	if (afterDate) query += ` after:${afterDate}`;
	if (beforeDate) query += ` before:${beforeDate}`;
	return query;
}

// Parses an ISO date string (YYYY-MM-DD) into a Date at noon to avoid timezone edge cases
export function parseDate(isoDate: string): Date {
	const [year, month, day] = isoDate.split('-').map(Number);
	return new Date(year, month - 1, day, 13, 0, 0, 0);
}

// Returns the time range in milliseconds for a given number of months (approx 30 days each)
export function getTimeRange(months: number): number {
	return months * 30 * 24 * 60 * 60 * 1000;
}

// Formats a Date as YYYY-MM-DD in the given IANA timezone — replaces GAS Utilities.formatDate
export function formatDateISO(date: Date, timeZone: string): string {
	// en-CA locale produces the YYYY-MM-DD format natively
	return new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(date);
}

// =============================================================================
// General — utility functions available to all packages
// =============================================================================

// Formats an amount with the specified number of decimal places
export function formatAmount(amount: number, decimals: number = 2): string {
	return amount.toFixed(decimals);
}

// Builds an HTML anchor link to a Bkper book
export function buildBookAnchor(bookId: string, bookName: string): string {
	return `<a href='https://app.bkper.com/b/#transactions:bookId=${bookId}'>${bookName}</a>`;
}
