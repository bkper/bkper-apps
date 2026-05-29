import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { BkperAuth } from '@bkper/web-auth';
import type { ContextParams } from '@inventory-bot-cloudflare/shared';

const isLocalDev =
	window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

@customElement('inventory-bot-app')
export class InventoryBotApp extends LitElement {

	// Use light DOM so global Shoelace and Bkper design system styles apply directly
	createRenderRoot() {
		return this;
	}

	static styles = css`
		body, div {
			font-family: var(--sl-font-sans);
			font-size: var(--sl-font-size-small);
		}

		.header, .body {
			padding: var(--sl-spacing-medium);
		}

		.body {
			padding-bottom: 0;
		}

		.header {
			font-size: 120%;
			background-color: #f5f5f5;
			text-align: center;
		}

		.sub-header {
			display: flex;
			height: 40px;
			font-size: var(--sl-font-size-medium);
			align-items: center;
			justify-content: center;
		}

		#account-list {
			padding-bottom: 10px;
		}

		.footer, .accounts-panel {
			display: flex;
			align-items: center;
		}

		.accounts-panel {
			padding-right: 5px;
			padding-top: 10px;
		}

		.footer {
			justify-content: center;
			padding: var(--sl-spacing-small);
			gap: var(--sl-spacing-large);
		}

		#error-panel {
			display: flex;
			justify-content: center;
			color: red;
		}
	`;

	// Resolved inventory book context — populated on init from /api/context-params
	@state() private contextParams: ContextParams | undefined;

	// Account list shown before an operation runs
	@state() private accounts: { accountName: string; accountId: string }[] = [];

	// Results shown after calculate or reset completes
	@state() private results: { accountName: string; result: string }[] | undefined;

	// Disables all buttons during any in-flight request
	@state() private loading = false;

	// Displays inline when any request fails
	@state() private error: string | undefined;

	private auth = new BkperAuth({
		baseUrl: isLocalDev ? window.location.origin : undefined,
		onLoginSuccess: () => this.loadContext(),
		onLoginRequired: () => {},
	});

	connectedCallback() {
		super.connectedCallback();
		// Kick off auth — triggers onLoginSuccess or onLoginRequired
		this.auth.init();
	}

	// Resolves context params then loads the account list
	private async loadContext() {
		this.loading = true;
		this.error = undefined;
		try {
			// Read URL params passed by Bkper when opening the menu popup
			const params = new URL(window.location.href).searchParams;
			const bookId = params.get('bookId') ?? '';
			const accountId = params.get('accountId');
			const groupId = params.get('groupId');

			// Resolve financial book context to inventory book coordinates
			const query = new URLSearchParams({ bookId });
			if (accountId) query.set('accountId', accountId);
			if (groupId) query.set('groupId', groupId);
			this.contextParams = await this.apiGet<ContextParams>(`/api/context-params?${query}`);

			// Fetch the sorted list of accounts to display
			const accountsQuery = new URLSearchParams({ bookId: this.contextParams.book.id });
			if (this.contextParams.account) accountsQuery.set('accountId', this.contextParams.account.id);
			if (this.contextParams.group) accountsQuery.set('groupId', this.contextParams.group.id);
			this.accounts = await this.apiGet<{ accountName: string; accountId: string }[]>(
				`/api/accounts?${accountsQuery}`,
			);
		} catch (e) {
			this.error = String(e);
		} finally {
			this.loading = false;
		}
	}

	// Validates then runs FIFO COGS calculation for all relevant accounts
	private async calculate() {
		if (!this.contextParams) return;
		this.loading = true;
		this.error = undefined;
		try {
			await this.apiPost('/api/validate', { bookId: this.contextParams.book.id });
			this.results = await this.apiPost<{ accountName: string; result: string }[]>(
				'/api/calculate',
				{ contextParams: this.contextParams },
			);
		} catch (e) {
			this.error = String(e);
		} finally {
			this.loading = false;
		}
	}

	// Validates then resets all COGS data for the inventory book accounts
	private async reset() {
		if (!this.contextParams) return;
		this.loading = true;
		this.error = undefined;
		try {
			await this.apiPost('/api/validate', { bookId: this.contextParams.book.id });
			this.results = await this.apiPost<{ accountName: string; result: string }[]>(
				'/api/reset',
				{ contextParams: this.contextParams },
			);
		} catch (e) {
			this.error = String(e);
		} finally {
			this.loading = false;
		}
	}

	private closeWindow() {
		try {
			window.top?.close();
		} catch (e) {
			console.log('Attempt to automatically close window failed:', e);
		}
	}

	render() {
		return html`
			<div class="header">
				Cost of goods sold for&nbsp;<strong>${this.contextParams?.book.name ?? '...'}</strong>
			</div>

			<div class="body">
				<div class="sub-header">
					Calculate using FIFO method for accounts:
				</div>

				<div class="accounts-panel">
					<ul id="account-list">
						${this.results
							? this.results.map(r => html`<li><p>${r.accountName}:&nbsp;${r.result}</p></li>`)
							: this.accounts.map(a => html`<li><p>${a.accountName}</p></li>`)
						}
					</ul>
				</div>
			</div>

			${this.error ? html`<div id="error-panel">${this.error}</div>` : ''}

			<div class="footer">
				<sl-button
					id="calculate-button"
					variant="default"
					?disabled=${this.loading}
					@click=${this.calculate}
				>Calculate</sl-button>
				<sl-button
					id="close-button"
					variant="default"
					?disabled=${this.loading}
					@click=${this.closeWindow}
				>Close</sl-button>
			</div>

			<div class="footer">
				<sl-button
					id="reset-button"
					variant="default"
					outline
					size="small"
					?disabled=${this.loading}
					@click=${this.reset}
				>Reset</sl-button>
			</div>
		`;
	}

	// Sends an authenticated GET request to the Hono server
	private async apiGet<T>(path: string): Promise<T> {
		const token = await this.auth.getAccessToken();
		const res = await fetch(path, {
			headers: { Authorization: `Bearer ${token}` },
		});
		const data = await res.json();
		if (!res.ok) throw new Error(data.error ?? 'Request failed');
		return data as T;
	}

	// Sends an authenticated POST request with a JSON body to the Hono server
	private async apiPost<T>(path: string, body: unknown): Promise<T> {
		const token = await this.auth.getAccessToken();
		const res = await fetch(path, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(body),
		});
		const data = await res.json();
		if (!res.ok) throw new Error(data.error ?? 'Request failed');
		return data as T;
	}

}
