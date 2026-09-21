export type PerformanceMetric = string | number | boolean;

export interface PerformanceMonitor {
    now(): number;
    log(event: string, metrics: Readonly<Record<string, PerformanceMetric>>): void;
}

export const silentPerformanceMonitor: PerformanceMonitor = {
    now: () => performance.now(),
    log: () => undefined,
};

export function createPerformanceMonitor(requestId: string): PerformanceMonitor {
    return {
        now: () => performance.now(),
        log: (event, metrics) => {
            console.info(
                JSON.stringify({
                    source: 'merge-duplicates-performance',
                    requestId,
                    event,
                    metrics,
                })
            );
        },
    };
}

export function elapsedMilliseconds(startedAt: number, completedAt: number): number {
    return Math.round((completedAt - startedAt) * 100) / 100;
}
