import { AccountType, type Account, type Transaction } from 'bkper-js';
import {
    FWD_PURCHASE_EXC_RATE_PROP,
    FWD_SALE_EXC_RATE_PROP,
    NEEDS_REBUILD_PROP,
    PURCHASE_EXC_RATE_PROP,
    SALE_EXC_RATE_PROP,
    STOCK_EXC_CODE_PROP,
} from '../../shared/constants.js';

export class ValidationAccount {
    private account: Account;

    private uncheckedPurchases: Transaction[] = [];
    private uncheckedSales: Transaction[] = [];

    constructor(account: Account) {
        this.account = account;
    }

    getAccount(): Account {
        return this.account;
    }

    pushUncheckedPurchase(purchase: Transaction): void {
        this.uncheckedPurchases.push(purchase);
    }

    pushUncheckedSale(sale: Transaction): void {
        this.uncheckedSales.push(sale);
    }

    needsRebuild(): boolean {
        return this.account.getProperty(NEEDS_REBUILD_PROP) ? true : false;
    }

    hasUncalculatedResults(): boolean {
        return this.uncheckedPurchases.length > 0 && this.uncheckedSales.length > 0 ? true : false;
    }

    async hasTransactionsMissingExcRates(baseCurrency?: string): Promise<boolean> {
        const accountCurrency = await this.getExchangeCode();
        if (accountCurrency && baseCurrency && accountCurrency !== baseCurrency) {
            // Purchases
            if (this.uncheckedPurchases.length > 0) {
                for (const purchase of this.uncheckedPurchases) {
                    const excRateProp = purchase.getProperty(PURCHASE_EXC_RATE_PROP);
                    const fwdExcRateProp = purchase.getProperty(FWD_PURCHASE_EXC_RATE_PROP);
                    if (!excRateProp && !fwdExcRateProp) {
                        return true;
                    }
                }
            }
            // Sales
            if (this.uncheckedSales.length > 0) {
                for (const sale of this.uncheckedSales) {
                    const excRateProp = sale.getProperty(SALE_EXC_RATE_PROP);
                    const fwdExcRateProp = sale.getProperty(FWD_SALE_EXC_RATE_PROP);
                    if (!excRateProp && !fwdExcRateProp) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private async getExchangeCode(): Promise<string | null> {
        const type = this.account.getType();
        if (type == AccountType.INCOMING || type == AccountType.OUTGOING) {
            return null;
        }
        const groups = await this.account.getGroups();
        if (groups && groups.length > 0) {
            for (const group of groups) {
                if (!group) {
                    continue;
                }
                const exchangeCode = group.getProperty(STOCK_EXC_CODE_PROP);
                if (exchangeCode != null && exchangeCode.trim() !== '') {
                    return exchangeCode;
                }
            }
        }
        return null;
    }
}
