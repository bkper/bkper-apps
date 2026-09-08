export enum SummaryState {
    EMPTY = 'empty',
    DONE = 'done',
    REBUILD = 'rebuild',
    RESETTING = 'resetting',
    CALCULATING = 'calculating',
    LOCKED = 'locked',
    SALE_QUANTITY_ERROR = 'sale_quantity_error',
    CREDIT_NOTE_QUANTITY_ERROR = 'credit_note_quantity_error',
}

export class Summary {
    private readonly accountId: string;
    private state = SummaryState.EMPTY;
    private result = 'Nothing to calculate';

    constructor(accountId: string) {
        this.accountId = accountId;
    }

    getAccountId(): string {
        return this.accountId;
    }

    getResult(): string {
        return this.result;
    }

    getState(): SummaryState {
        return this.state;
    }

    done(message?: string): this {
        this.state = SummaryState.DONE;
        if (message) {
            this.result = message;
            return this;
        }
        this.result = `Done! ${JSON.stringify(this.result)}`;
        return this;
    }

    rebuild(): this {
        this.state = SummaryState.REBUILD;
        this.result = 'Account needs rebuild: resetting...';
        return this;
    }

    resetingAsync(): this {
        this.state = SummaryState.RESETTING;
        this.result = 'Resetting...';
        return this;
    }

    calculatingAsync(): this {
        this.state = SummaryState.CALCULATING;
        this.result = 'Calculating...';
        return this;
    }

    lockError(): this {
        this.state = SummaryState.LOCKED;
        this.result = 'Cannot proceed: collection has locked/closed book(s)';
        return this;
    }

    salequantityError(): this {
        this.state = SummaryState.SALE_QUANTITY_ERROR;
        this.result = 'Cannot proceed: sales quantity is greater than quantity purchased';
        return this;
    }

    creditNoteQuantityError(creditNote: string): this {
        this.state = SummaryState.CREDIT_NOTE_QUANTITY_ERROR;
        this.result = `Cannot proceed: credit note quantity is greater than purchased quantity. Credit note: ${creditNote}`;
        return this;
    }

    json(): this {
        this.result = JSON.stringify(this.result);
        return this;
    }
}
