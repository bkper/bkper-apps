import { AccountType, type Account, type Transaction } from 'bkper-js';
import { COGS_CALC_DATE_PROP, EXC_CODE_PROP, NEEDS_REBUILD_PROP } from '../../shared/constants.js';

export class GoodAccount {
    private readonly account: Account;
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

    update(): Promise<Account> {
        return this.account.update();
    }

    getNormalizedName(): string {
        return this.account.getNormalizedName();
    }

    isArchived(): boolean | undefined {
        return this.account.isArchived();
    }

    isPermanent(): boolean | undefined {
        return this.account.isPermanent();
    }

    getCOGSCalculationDateValue(): number | null {
        const calculationDate = this.getCOGSCalculationDate();
        return calculationDate ? +calculationDate.replaceAll('-', '') : null;
    }

    getCOGSCalculationDate(): string | undefined {
        return this.account.getProperty(COGS_CALC_DATE_PROP);
    }

    setCOGSCalculationDate(date: string): GoodAccount {
        this.account.setProperty(COGS_CALC_DATE_PROP, date);
        return this;
    }

    deleteCOGSCalculationDate(): GoodAccount {
        this.account.deleteProperty(COGS_CALC_DATE_PROP);
        return this;
    }

    needsRebuild(): boolean {
        return this.account.getProperty(NEEDS_REBUILD_PROP) == 'TRUE';
    }

    flagNeedsRebuild(): void {
        this.account.setProperty(NEEDS_REBUILD_PROP, 'TRUE');
    }

    clearNeedsRebuild(): void {
        this.account.deleteProperty(NEEDS_REBUILD_PROP);
    }

    async getExchangeCode(): Promise<string | null> {
        const type = this.account.getType();
        if (type == AccountType.INCOMING || type == AccountType.OUTGOING) {
            return null;
        }
        const groups = await this.account.getGroups();
        if (groups != null) {
            for (const group of groups) {
                if (group == null) {
                    continue;
                }
                const exchange = group.getProperty(EXC_CODE_PROP);
                if (exchange != null && exchange.trim() != '') {
                    return exchange;
                }
            }
        }
        return null;
    }

    pushTrash(transaction: Transaction): void {
        this.trash.push(transaction);
    }

    async cleanTrash(): Promise<void> {
        for (const transaction of this.trash) {
            if (transaction.isTrashed()) {
                continue;
            }
            if (transaction.isChecked()) {
                await transaction.uncheck();
            }
            await transaction.trash();
        }
    }
}
