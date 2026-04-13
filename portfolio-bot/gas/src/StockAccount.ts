class StockAccount {

    private account: Bkper.Account;
    public trash: Bkper.Transaction[] = [];

    constructor(account: Bkper.Account) {
        this.account = account;
    }

    getId() {
        return this.account.getId();
    }

    getName() {
        return this.account.getName();
    }

    getAccount() {
        return this.account;
    }

    update() {
        this.account.update();
    }

    getNormalizedName() {
        return this.account.getNormalizedName();
    }

    isArchived() {
        return this.account.isArchived();
    }

    isPermanent() {
        return this.account.isPermanent();
    }

    getRealizedDateValue(): number | null {
        return this.getRealizedDate() ? +(this.getRealizedDate().replaceAll('-', '')) : null;
    }

    getRealizedDate(): string {
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

    getForwardedDateValue(): number | null {
        return this.getForwardedDate() ? +(this.getForwardedDate().replaceAll('-', '')) : null;
    }

    getForwardedDate(): string | undefined {
        return this.account.getProperty(FORWARDED_DATE_PROP);
    }

    setForwardedDate(date: string): StockAccount {
        this.account.setProperty(FORWARDED_DATE_PROP, date);
        return this;
    }

    deleteForwardedDate(): StockAccount {
        this.account.deleteProperty(FORWARDED_DATE_PROP);
        return this;
    }

    needsRebuild(): boolean {
        return this.account.getProperty(NEEDS_REBUILD_PROP) == 'TRUE' ? true : false;
    }

    flagNeedsRebuild(): void {
        this.account.setProperty(NEEDS_REBUILD_PROP, 'TRUE');
    }

    clearNeedsRebuild(): void {
        this.account.deleteProperty(NEEDS_REBUILD_PROP);
    }

    getExchangeCode(): string | null {
        if (this.account.getType() == BkperApp.AccountType.INCOMING || this.account.getType() == BkperApp.AccountType.OUTGOING) {
            return null;
        }
        let groups = this.account.getGroups();
        if (groups != null) {
            for (const group of groups) {
                if (group == null) {
                    continue;
                }
                let exchange = group.getProperty(STOCK_EXC_CODE_PROP);
                if (exchange != null && exchange.trim() != '') {
                    return exchange;
                }
            }
        }
        return null;
    }

    setForwardedExcRate(fwdExcRate: Bkper.Amount): StockAccount {
        this.account.setProperty(FORWARDED_EXC_RATE_PROP, fwdExcRate?.toString());
        return this;
    }

    deleteForwardedExcRate(): StockAccount {
        this.account.deleteProperty(FORWARDED_EXC_RATE_PROP);
        return this;
    }

    setForwardedPrice(fwdPrice: Bkper.Amount): StockAccount {
        this.account.setProperty(FORWARDED_PRICE_PROP, fwdPrice?.toString());
        return this;
    }

    deleteForwardedPrice(): StockAccount {
        this.account.deleteProperty(FORWARDED_PRICE_PROP);
        return this;
    }

    pushTrash(transaction: Bkper.Transaction): void {
        this.trash.push(transaction);
    }

    cleanTrash(): void {
        for (const transaction of this.trash) {
            if (transaction.isTrashed()) {
                continue;
            }
            if (transaction.isChecked()) {
                transaction.uncheck();
            }
            transaction.trash();
        }
    }

}
