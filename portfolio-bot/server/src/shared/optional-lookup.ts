import { BkperError } from 'bkper-js';

export async function optionalLookup<T>(
    lookup: () => Promise<T | undefined>
): Promise<T | undefined> {
    try {
        return await lookup();
    } catch (error: unknown) {
        if (error instanceof BkperError && error.code === 404) {
            return undefined;
        }
        throw error;
    }
}
