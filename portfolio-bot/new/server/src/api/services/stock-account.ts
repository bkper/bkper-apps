import { AccountType, type Account } from 'bkper-js';
import {
    FORWARDED_DATE_PROP,
    FORWARDED_EXC_RATE_PROP,
    FORWARDED_PRICE_PROP,
    LEGACY_REALIZED_DATE_PROP,
    NEEDS_REBUILD_PROP,
    REALIZED_DATE_PROP,
    STOCK_EXC_CODE_PROP,
} from '../../shared/constants.js';

export class StockAccount {
    private readonly account: Account;

    constructor(account: Account) {
        this.account = account;
    }

    getId(): string | undefined {
        return this.account.getId();
    }

    getName(): string | undefined {
        return this.account.getName();
    }

    update(): Promise<Account> {
        return this.account.update();
    }

    getRealizedDateValue(): number | null {
        const realizedDate = this.getRealizedDate();
        return realizedDate ? +realizedDate.replaceAll('-', '') : null;
    }

    getRealizedDate(): string | undefined {
        const legacyRealizedDate = this.account.getProperty(LEGACY_REALIZED_DATE_PROP);
        if (legacyRealizedDate) {
            return `${legacyRealizedDate.substring(0, 4)}-${legacyRealizedDate.substring(4, 6)}-${legacyRealizedDate.substring(6, 8)}`;
        }
        return this.account.getProperty(REALIZED_DATE_PROP);
    }

    setRealizedDate(date: string): StockAccount {
        this.account
            .deleteProperty('last_sale_date')
            .deleteProperty(LEGACY_REALIZED_DATE_PROP)
            .setProperty(REALIZED_DATE_PROP, date);
        return this;
    }

    deleteRealizedDate(): StockAccount {
        this.account
            .deleteProperty('last_sale_date')
            .deleteProperty(LEGACY_REALIZED_DATE_PROP)
            .deleteProperty(REALIZED_DATE_PROP);
        return this;
    }

    getForwardedDate(): string | undefined {
        return this.account.getProperty(FORWARDED_DATE_PROP);
    }

    deleteForwardedDate(): StockAccount {
        this.account.deleteProperty(FORWARDED_DATE_PROP);
        return this;
    }

    needsRebuild(): boolean {
        return this.account.getProperty(NEEDS_REBUILD_PROP) == 'TRUE';
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
                const exchange = group.getProperty(STOCK_EXC_CODE_PROP);
                if (exchange != null && exchange.trim() != '') {
                    return exchange;
                }
            }
        }
        return null;
    }

    deleteForwardedExcRate(): StockAccount {
        this.account.deleteProperty(FORWARDED_EXC_RATE_PROP);
        return this;
    }

    deleteForwardedPrice(): StockAccount {
        this.account.deleteProperty(FORWARDED_PRICE_PROP);
        return this;
    }
}
