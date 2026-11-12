/**
 * Turns a one-key property reader into bkper-js's `getProperty(...keys)`: the first non-blank value among the keys.
 */
export function firstNonBlank(read: (key: string) => string | undefined | null): (...keys: string[]) => string | undefined {
    return (...keys: string[]) => {
        for (const key of keys) {
            const value = read(key);
            if (value != null && value.trim() !== '') {
                return value;
            }
        }
        return undefined;
    };
}
