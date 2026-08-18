class ValidationAccount {

    private account: Bkper.Account;

    private uncheckedPurchases: Bkper.Transaction[] = [];
    private uncheckedSales: Bkper.Transaction[] = [];

    constructor(account: Bkper.Account) {
        this.account = account;
    }

    getAccount(): Bkper.Account {
        return this.account;
    }

    pushUncheckedPurchase(purchase: Bkper.Transaction): void {
        this.uncheckedPurchases.push(purchase);
    }

    pushUncheckedSale(sale: Bkper.Transaction): void {
        this.uncheckedSales.push(sale);
    }

    needsRebuild(): boolean {
        return this.account.getProperty(NEEDS_REBUILD_PROP) ? true : false;
    }

    hasUncalculatedResults(): boolean {
        return (this.uncheckedPurchases.length > 0 && this.uncheckedSales.length > 0) ? true : false;
    }

    private getExchangeCode(): string | null {
        if (this.account.getType() == BkperApp.AccountType.INCOMING || this.account.getType() == BkperApp.AccountType.OUTGOING) {
            return null;
        }
        const groups = this.account.getGroups();
        if (groups && groups.length > 0) {
            for (const group of groups) {
                if (!group) {
                    continue;
                }
                let exchangeCode = group.getProperty(STOCK_EXC_CODE_PROP);
                if (exchangeCode !== null && exchangeCode.trim() !== '') {
                    return exchangeCode;
                }
            }
        }
        return null;
    }

    hasExchangeRatesMissing(baseCurrency?: string): boolean {
        const accountCurrency = this.getExchangeCode();
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

}
