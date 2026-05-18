import { Account, AccountType, Transaction } from 'bkper-js';
import { COGS_CALC_DATE_PROP, EXC_CODE_PROP, NEEDS_REBUILD_PROP } from '@inventory-bot-cloudflare/shared';

// Wraps a bkper-js Account to provide inventory-specific convenience methods
export class GoodAccount {

	private account: Account;
	public trash: Transaction[] = [];

	constructor(account: Account) {
		this.account = account;
	}

	getId(): string | undefined {
		return this.account.getId();
	}

	getName(): string | undefined {
		return this.account.getName();
	}

	getAccount(): Account {
		return this.account;
	}

	async update(): Promise<void> {
		await this.account.update();
	}

	getNormalizedName(): string | undefined {
		return this.account.getNormalizedName();
	}

	isArchived(): boolean {
		return this.account.isArchived() ?? false;
	}

	isPermanent(): boolean {
		return this.account.isPermanent() ?? false;
	}

	// Returns the COGS calculation date as a numeric value (YYYYMMDD) for comparison
	getCOGSCalculationDateValue(): number | null {
		const date = this.getCOGSCalculationDate();
		return date ? +(date.replaceAll('-', '')) : null;
	}

	getCOGSCalculationDate(): string | undefined {
		return this.account.getProperty(COGS_CALC_DATE_PROP);
	}

	setCOGSCalculationDate(date: string): this {
		this.account.setProperty(COGS_CALC_DATE_PROP, date);
		return this;
	}

	deleteCOGSCalculationDate(): this {
		this.account.deleteProperty(COGS_CALC_DATE_PROP);
		return this;
	}

	needsRebuild(): boolean {
		return this.account.getProperty(NEEDS_REBUILD_PROP) === 'TRUE';
	}

	flagNeedsRebuild(): void {
		this.account.setProperty(NEEDS_REBUILD_PROP, 'TRUE');
	}

	clearNeedsRebuild(): void {
		this.account.deleteProperty(NEEDS_REBUILD_PROP);
	}

	// Reads exchange code from the account's parent groups
	async getExchangeCode(): Promise<string | null> {
		const type = this.account.getType();
		if (type === AccountType.INCOMING || type === AccountType.OUTGOING) {
			return null;
		}
		const groups = await this.account.getGroups();
		for (const group of groups ?? []) {
			if (group == null) continue;
			const exchange = group.getProperty(EXC_CODE_PROP);
			if (exchange != null && exchange.trim() !== '') {
				return exchange;
			}
		}
		return null;
	}

}
