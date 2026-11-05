import { describe, expect, it } from 'vitest';
import { ServerTiming } from '../../src/services/timing';

function clock(...readings: number[]) {
    return () => readings.shift() ?? 0;
}

describe('ServerTiming', () => {
    it('has no header before anything is measured', () => {
        expect(new ServerTiming().header()).toBeUndefined();
    });

    it('measures work and adds up repeated metrics, in first-measured order', async () => {
        const timing = new ServerTiming(clock(0, 12.34, 20, 320.5, 400, 402));
        await timing.measure('kv', async () => 'miss');
        await timing.measure('balances', async () => 'loaded');
        await timing.measure('kv', async () => 'stored');
        expect(timing.header()).toBe('kv;dur=14.3, balances;dur=300.5');
    });

    it('returns the work result and still records failed work', async () => {
        const timing = new ServerTiming(clock(0, 5, 10, 15));
        await expect(timing.measure('jev', async () => 42)).resolves.toBe(42);
        await expect(
            timing.measure('balances', async () => {
                throw new Error('upstream');
            })
        ).rejects.toThrow('upstream');
        expect(timing.header()).toBe('jev;dur=5, balances;dur=5');
    });
});
