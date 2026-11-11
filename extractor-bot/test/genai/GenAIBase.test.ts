import { describe, expect, it } from 'bun:test';
import { GenAIBase } from '../../src/genai/GenAIBase.js';

class TestGenAI extends GenAIBase {
    protected getModel(): string {
        return 'test-model';
    }

    testCalculateBackoffDelay(attemptNumber: number): number {
        return this.calculateBackoffDelay(attemptNumber);
    }

    testMaxRetries(): number {
        return GenAIBase.MAX_RETRIES;
    }

    testInitialBackoffMs(): number {
        return GenAIBase.INITIAL_BACKOFF_MS;
    }
}

describe('GenAIBase', () => {
    it('calculates exponential backoff delays', () => {
        const genAI = new TestGenAI();

        expect(genAI.testCalculateBackoffDelay(1)).toBe(1000);
        expect(genAI.testCalculateBackoffDelay(2)).toBe(2000);
        expect(genAI.testCalculateBackoffDelay(3)).toBe(4000);
    });

    it('allows three total attempts starting with a one-second backoff', () => {
        const genAI = new TestGenAI();

        expect(genAI.testMaxRetries()).toBe(2);
        expect(genAI.testInitialBackoffMs()).toBe(1000);
    });
});
