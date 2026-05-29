import { AccountType, Bkper } from 'bkper-js';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import type { Env } from '../../env.js';
import { INVENTORY_BOOK_PROP } from './shared/constants.js';
import type { ContextParams } from './shared/types.js';
import { getInventoryBook, hasPendingTasks } from './bot-service.js';
import { calculateCostOfSalesForAccount } from './calculate-cost-of-sales-service.js';
import { resetCostOfSalesForAccount } from './reset-cost-of-sales-service.js';
import { registerEventRoutes } from './events/routes.js';

const app = new Hono<{ Bindings: Env }>();

app.use(logger());
app.use(prettyJSON());

// Health check
app.get('/health', c => c.json({ status: 'ok' }));

registerEventRoutes(app);

// =============================================================================
// API routes — called by the web client via fetch('/api/...')
// =============================================================================

// Resolves the financial book context (bookId, accountId, groupId from URL params)
// into inventory book coordinates and returns them to the client on menu open
app.get('/api/context-params', async c => {
	try {
		const bkper = getBkper();
		const bookId = c.req.query('bookId') ?? '';
		const accountId = c.req.query('accountId');
		const groupId = c.req.query('groupId');

		// Load the financial book and locate the inventory book in its collection
		const book = await bkper.getBook(bookId);
		const inventoryBook = getInventoryBook(book);
		if (!inventoryBook) {
			return c.json({ error: `Inventory Book not found in the collection` }, 400);
		}

		// Pre-cache accounts for subsequent lookups
		await book.getAccounts();
		await inventoryBook.getAccounts();

		// Resolve group name from the financial book, then find it in the inventory book
		const group = groupId ? await book.getGroup(groupId) : undefined;
		const groupName = group?.getName();
		const inventoryGroup = group && groupName ? await inventoryBook.getGroup(groupName) : undefined;

		// Resolve account from the financial book, then find counterpart in the inventory book
		const account = accountId ? await book.getAccount(accountId) : undefined;
		const inventoryAccount = account?.getName() ? await inventoryBook.getAccount(account.getName()!) : undefined;

		const contextParams: ContextParams = {
			book: { id: inventoryBook.getId()!, name: inventoryBook.getName()! },
			account: inventoryAccount
				? { id: inventoryAccount.getId()!, name: inventoryAccount.getName()! }
				: undefined,
			group: inventoryGroup
				? { id: inventoryGroup.getId()!, name: groupName! }
				: undefined,
		};

		return c.json(contextParams);
	} catch (e) {
		return c.json({ error: String(e) }, 500);
	}
});

// Returns the sorted list of ASSET accounts to be calculated or displayed in the menu
// bookId, accountId, groupId are already in inventory book space (from context-params)
app.get('/api/accounts', async c => {
	try {
		const bkper = getBkper();
		const bookId = c.req.query('bookId') ?? '';
		const accountId = c.req.query('accountId');
		const groupId = c.req.query('groupId');

		const inventoryBook = await bkper.getBook(bookId);
		await inventoryBook.getAccounts();

		// Collect ASSET accounts: single account, group accounts, or all accounts
		let accountsMap = new Map<string, string>();

		if (accountId) {
			const account = await inventoryBook.getAccount(accountId);
			if (account) accountsMap.set(account.getName()!, account.getId()!);
		} else if (groupId) {
			const group = await inventoryBook.getGroup(groupId);
			const accounts = await group!.getAccounts();
			for (const account of accounts) {
				if (account.getType() === AccountType.ASSET) {
					accountsMap.set(account.getName()!, account.getId()!);
				}
			}
		} else {
			const accounts = await inventoryBook.getAccounts();
			for (const account of accounts) {
				if (account.getType() === AccountType.ASSET) {
					accountsMap.set(account.getName()!, account.getId()!);
				}
			}
		}

		// Sort alphabetically before returning
		accountsMap = new Map([...accountsMap.entries()].sort());

		const result = Array.from(accountsMap.entries()).map(([name, id]) => ({
			accountName: name,
			accountId: id,
		}));

		return c.json(result);
	} catch (e) {
		return c.json({ error: String(e) }, 500);
	}
});

// Validates that the inventory book has no pending backlog tasks before an operation starts
// Body: { bookId: string }  — bookId is the inventory book id (from context-params)
app.post('/api/validate', async c => {
	try {
		const bkper = getBkper();
		const { bookId } = await c.req.json<{ bookId: string }>();

		const inventoryBook = await bkper.getBook(bookId);
		if (!getInventoryBook(inventoryBook)) {
			return c.json(
				{ error: `Inventory Book not found in the collection. Please set the property ${INVENTORY_BOOK_PROP} to the Inventory Book.` },
				400,
			);
		}

		if (await hasPendingTasks(inventoryBook)) {
			return c.json({ error: 'Cannot start operation: Inventory Book has pending tasks' }, 400);
		}

		return c.json({ ok: true });
	} catch (e) {
		return c.json({ error: String(e) }, 500);
	}
});

// Runs COGS calculation for all relevant accounts using the FIFO method
// Body: { contextParams: ContextParams, toDate?: string }
app.post('/api/calculate', async c => {
	try {
		const bkper = getBkper();
		const { contextParams, toDate } = await c.req.json<{ contextParams: ContextParams; toDate?: string }>();

		console.log(`book id: ${contextParams.book.id}, account id: ${contextParams.account?.id}, date input: ${toDate}`);

		// Resolve the list of accounts to calculate from context
		const accountsToCalculate = await getAccountsToCalculate(bkper, contextParams);

		const inventoryBook = await bkper.getBook(contextParams.book.id);

		// Run calculate for each account sequentially and collect results
		const results: { accountName: string; result: string }[] = [];
		for (const { accountName, accountId } of accountsToCalculate) {
			const summary = await calculateCostOfSalesForAccount(inventoryBook, accountId, toDate);
			results.push({ accountName, result: summary.getResult() });
		}

		return c.json(results);
	} catch (e) {
		return c.json({ error: String(e) }, 500);
	}
});

// Resets COGS data for all ASSET accounts in the inventory book
// Body: { contextParams: ContextParams }
app.post('/api/reset', async c => {
	try {
		const bkper = getBkper();
		const { contextParams } = await c.req.json<{ contextParams: ContextParams }>();

		console.log(`book id: ${contextParams.book.id}, account id: ${contextParams.account?.id}`);

		const inventoryBook = await bkper.getBook(contextParams.book.id);
		await inventoryBook.getAccounts();

		// Collect all ASSET accounts and sort alphabetically
		const accounts = await inventoryBook.getAccounts();
		const accountsToReset = accounts
			.filter(a => a.getType() === AccountType.ASSET)
			.sort((a, b) => (a.getName() ?? '').localeCompare(b.getName() ?? ''));

		// Run reset for each account sequentially and collect results
		const results: { accountName: string; result: string }[] = [];
		for (const account of accountsToReset) {
			const summary = await resetCostOfSalesForAccount(inventoryBook, account.getId()!);
			results.push({ accountName: account.getName()!, result: summary.getResult() });
		}

		return c.json(results);
	} catch (e) {
		return c.json({ error: String(e) }, 500);
	}
});

// =============================================================================
// Helpers
// =============================================================================

// Platform outbound auth injects the validated user token for Bkper API calls.
function getBkper(): Bkper {
	return new Bkper();
}

// Resolves the sorted list of accounts to calculate from the context params
async function getAccountsToCalculate(
	bkper: Bkper,
	contextParams: ContextParams,
): Promise<{ accountName: string; accountId: string }[]> {
	const inventoryBook = await bkper.getBook(contextParams.book.id);
	await inventoryBook.getAccounts();

	let accountsMap = new Map<string, string>();

	if (contextParams.account) {
		const account = await inventoryBook.getAccount(contextParams.account.id);
		if (account) accountsMap.set(account.getName()!, account.getId()!);
	} else if (contextParams.group) {
		const group = await inventoryBook.getGroup(contextParams.group.id);
		const accounts = await group!.getAccounts();
		for (const account of accounts) {
			if (account.getType() === AccountType.ASSET) {
				accountsMap.set(account.getName()!, account.getId()!);
			}
		}
	} else {
		const accounts = await inventoryBook.getAccounts();
		for (const account of accounts) {
			if (account.getType() === AccountType.ASSET) {
				accountsMap.set(account.getName()!, account.getId()!);
			}
		}
	}

	// Sort alphabetically before returning
	accountsMap = new Map([...accountsMap.entries()].sort());

	return Array.from(accountsMap.entries()).map(([name, id]) => ({
		accountName: name,
		accountId: id,
	}));
}

app.notFound(c => {
	if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/events')) {
		return c.json({ error: 'Not found' }, 404);
	}
	return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
