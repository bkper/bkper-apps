class GoodAccount {

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

    getCOGSCalculationDateValue(): number | null {
        return this.getCOGSCalculationDate() ? +(this.getCOGSCalculationDate().replaceAll('-', '')) : null;
    }

    getCOGSCalculationDate(): string {
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
                let exchange = group.getProperty(EXC_CODE_PROP);
                if (exchange != null && exchange.trim() != '') {
                    return exchange;
                }
            }
        }
        return null;
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
