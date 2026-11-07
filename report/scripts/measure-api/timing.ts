/** Milliseconds by metric name, from a `Server-Timing` header such as `user;dur=130, total;dur=412`. */
export function readTiming(header: string | null): Record<string, number> {
    const metrics: Record<string, number> = {};
    for (const entry of (header ?? '').split(',')) {
        const [name, ...params] = entry.trim().split(';');
        const duration = params
            .map(param => /^dur=([\d.]+)$/.exec(param.trim())?.[1])
            .find(Boolean);
        if (name && duration) {
            metrics[name] = Number(duration);
        }
    }
    return metrics;
}

/** The nearest-rank percentile `p` (above 0, up to 100) of `values`; `NaN` for none. */
export function percentile(values: number[], p: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
}
