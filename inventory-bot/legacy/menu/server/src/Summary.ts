class Summary {

    private accountId: string;
    private result: string = 'Nothing to calculate';
    private error = false;

    constructor(accountId: string) {
        this.accountId = accountId;
    }

    getAccountId(): string {
        return this.accountId;
    }

    getResult(): string {
        return this.result;
    }

    setResult(result: string): this {
        this.result = result;
        return this;
    }

    done(msg?: string): this {
        if (msg) {
            this.result = msg;
            return this;
        }
        this.result = `Done! ${JSON.stringify(this.result)}`;
        return this;
    }

    rebuild(): this {
        this.result = 'Account needs rebuild: reseting...';
        return this;
    }

    resetingAsync(): this {
        this.result = 'Reseted';
        return this;
    }

    calculatingAsync(): this {
        this.result = 'Calculated';
        return this;
    }

    lockError(): this {
        this.error = true;
        this.result = 'Cannot proceed: collection has locked/closed book(s)';
        return this;
    }

    salequantityError(): this {
        this.error = true;
        this.result = 'Cannot proceed: sales quantity is greater than quantity purchased';
        return this;
    }

    creditNoteQuantityError(creditNote: string): this {
        this.error = true;
        this.result = `Cannot proceed: credit note quantity is greater than purchased quantity. Credit note: ${creditNote}`;
        return this;
    }

    json(): this {
        this.result = JSON.stringify(this.result);
        return this;
    }

}