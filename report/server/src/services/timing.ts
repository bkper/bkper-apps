/**
 * Where a request spends its time, reported in the `Server-Timing` response header: `book` is
 * loading the Book's map from Bkper, `balances` its balances queries, and `total` the whole
 * request in the Worker.
 */
export type TimingMetric =
    'user' | 'kv' | 'book' | 'balances' | 'jev' | 'compute' | 'render' | 'total';

export interface Timing {
    /** Runs `work`, adding its duration to `metric`, whether it succeeds or fails. */
    measure<T>(metric: TimingMetric, work: () => Promise<T>): Promise<T>;
}

export class ServerTiming implements Timing {
    private readonly durations = new Map<TimingMetric, number>();

    constructor(private readonly clock: () => number = () => performance.now()) {}

    async measure<T>(metric: TimingMetric, work: () => Promise<T>): Promise<T> {
        const start = this.clock();
        try {
            return await work();
        } finally {
            const duration = this.clock() - start;
            this.durations.set(metric, (this.durations.get(metric) ?? 0) + duration);
        }
    }

    /** `Server-Timing` header value in milliseconds, or `undefined` when nothing was measured. */
    header(): string | undefined {
        if (this.durations.size === 0) {
            return undefined;
        }
        return [...this.durations]
            .map(([metric, duration]) => `${metric};dur=${Math.round(duration * 10) / 10}`)
            .join(', ');
    }
}
