/**
 * Shared retry infrastructure for Bkper AI interactions.
 */
export abstract class GenAIBase {
    protected static readonly MAX_RETRIES = 2; // Initial attempt + 2 retries = 3 total attempts

    protected static readonly INITIAL_BACKOFF_MS = 1000; // 1 second

    protected abstract getModel(): string;

    protected async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    protected calculateBackoffDelay(attemptNumber: number): number {
        return Math.pow(2, attemptNumber - 1) * GenAIBase.INITIAL_BACKOFF_MS;
    }
}
