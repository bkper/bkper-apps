export enum SummaryState {
    EMPTY = 'empty',
    DONE = 'done',
    REBUILD = 'rebuild',
    RESETTING = 'resetting',
    CALCULATING = 'calculating',
    LOCKED = 'locked',
    FORWARD_ERROR = 'forward_error',
}

export class Summary {
    private state = SummaryState.EMPTY;
    private message = '';

    getState(): SummaryState {
        return this.state;
    }

    getMessage(): string {
        return this.message;
    }

    done(message = 'Done!'): this {
        this.state = SummaryState.DONE;
        this.message = message;
        return this;
    }

    rebuild(): this {
        this.state = SummaryState.REBUILD;
        this.message = 'Account needs rebuild: reseting async...';
        return this;
    }

    resetingAsync(): this {
        this.state = SummaryState.RESETTING;
        this.message = 'Reseting async...';
        return this;
    }

    calculatingAsync(): this {
        this.state = SummaryState.CALCULATING;
        this.message = 'Calculating async...';
        return this;
    }

    lockError(): this {
        this.state = SummaryState.LOCKED;
        this.message = 'Cannot proceed: collection has locked/closed book(s)';
        return this;
    }

    forwardError(errorMsg: string): this {
        this.state = SummaryState.FORWARD_ERROR;
        this.message = errorMsg;
        return this;
    }
}
