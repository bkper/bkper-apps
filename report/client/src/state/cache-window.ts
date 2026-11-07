/**
 * How long the client reuses what it asked for: reports, and the suggestions of the Book's map.
 * The Worker keeps the map and balances as long; afterwards they are asked again, so relative
 * periods such as last month advance.
 */
export const CACHE_MS = 60_000;

/**
 * Whether something asked for at `at` is still fresh `now`, both in milliseconds. A clock that
 * went back reads as expired.
 */
export function isFresh(at: number, now: number): boolean {
    const age = now - at;
    return age >= 0 && age < CACHE_MS;
}
