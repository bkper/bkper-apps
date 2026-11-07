import { describe, expect, it } from 'vitest';
import { AppApiError, type BookName } from '../../src/api/app-api';
import { BookNames, type BookNamesApi } from '../../src/state/book-names';
import { CACHE_MS } from '../../src/state/cache-window';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

const FOOD: BookName = { id: 'a-food', name: 'Food', kind: 'account', root: 'g-expenses' };
const FEES: BookName = { id: 'g-fees', name: 'Fees', kind: 'group', root: 'g-fees' };
const RENT: BookName = { id: 'a-rent', name: 'Rent', kind: 'account', root: 'g-expenses' };

function setup() {
    const loads: {
        book: string;
        signal?: AbortSignal;
        result: ReturnType<typeof deferred<BookName[]>>;
    }[] = [];
    const api: BookNamesApi = {
        names: (book, options) => {
            const result = deferred<BookName[]>();
            loads.push({ book, signal: options?.signal, result });
            return result.promise;
        },
    };
    const clock = { now: 1_000_000 };
    const errors: unknown[] = [];
    const names = new BookNames(api, {
        now: () => clock.now,
        logger: { error: (...args: unknown[]) => errors.push(args) },
    });
    const offered = (text: string) =>
        names.complete(text, text.length).map(({ name }) => name.name);
    return { names, loads, clock, errors, offered };
}

describe('BookNames', () => {
    it('offers nothing until the names arrive, then completes from memory, with no request', async () => {
        const { names, loads, offered } = setup();
        names.open('book-1');
        expect(loads.map(load => load.book)).toEqual(['book-1']);
        expect(offered('fo')).toEqual([]);

        loads[0].result.resolve([FOOD, FEES]);
        await loads[0].result.promise;
        await Promise.resolve();
        expect(names.index.size).toBe(2);
        expect(offered('f')).toEqual([]);
        expect(offered('fo')).toEqual(['Food']);
        expect(offered('expenses fe')).toEqual(['Fees']);
        for (let i = 0; i < 1000; i++) names.complete('show me fo', 10);
        names.refresh();
        expect(loads).toHaveLength(1);
    });

    it('asks again once the names are older than a minute, keeping them until new ones arrive', async () => {
        const { names, loads, clock, offered } = setup();
        names.open('book-1');
        loads[0].result.resolve([FOOD]);
        await names.loaded;

        clock.now += CACHE_MS - 1;
        names.refresh();
        expect(loads).toHaveLength(1);
        clock.now += 1;
        names.refresh();
        names.refresh();
        expect(loads).toHaveLength(2);
        expect(offered('fo')).toEqual(['Food']);

        loads[1].result.resolve([FOOD, RENT]);
        await names.loaded;
        expect(offered('re')).toEqual(['Rent']);
    });

    it('keeps the same index when the names did not change', async () => {
        const { names, loads, clock } = setup();
        names.open('book-1');
        loads[0].result.resolve([FOOD, RENT]);
        await names.loaded;
        const index = names.index;

        clock.now += CACHE_MS;
        names.refresh();
        loads[1].result.resolve([{ ...FOOD }, { ...RENT }]);
        await names.loaded;
        expect(names.index).toBe(index);
    });

    it('keeps the names it has when asking again fails, and asks once more a minute later', async () => {
        const { names, loads, clock, errors, offered } = setup();
        names.open('book-1');
        loads[0].result.resolve([FOOD]);
        await names.loaded;

        clock.now += CACHE_MS;
        names.refresh();
        loads[1].result.reject(new AppApiError('Bkper failed', 502, 'upstream_error'));
        await names.loaded;
        expect(offered('fo')).toEqual(['Food']);
        expect(errors).toHaveLength(1);
        // A failure is not asked again on every keystroke.
        names.refresh();
        expect(loads).toHaveLength(2);
        clock.now += CACHE_MS;
        names.refresh();
        expect(loads).toHaveLength(3);
    });

    it('forgets the names when the Book can no longer be read', async () => {
        const { names, loads, clock, errors, offered } = setup();
        names.open('book-1');
        loads[0].result.resolve([FOOD]);
        await names.loaded;

        clock.now += CACHE_MS;
        names.refresh();
        loads[1].result.reject(new AppApiError('No access', 403, 'forbidden'));
        await names.loaded;
        expect(offered('fo')).toEqual([]);
        expect(errors).toEqual([]);
    });

    it('isolates each Book: another Book drops the names and late answers, even back again', async () => {
        const { names, loads, offered } = setup();
        names.open('book-1');
        loads[0].result.resolve([FOOD]);
        await names.loaded;
        names.open('book-1');
        expect(loads).toHaveLength(1);

        names.open('book-2');
        expect(loads[1].book).toBe('book-2');
        expect(names.bookId).toBe('book-2');
        expect(offered('fo')).toEqual([]);

        names.open('book-1');
        expect(loads[1].signal?.aborted).toBe(true);
        // Book 2's answer arrives late, after Book 1 opened again: it is dropped.
        loads[1].result.resolve([FEES]);
        await loads[1].result.promise;
        await Promise.resolve();
        expect(offered('fe')).toEqual([]);
        loads[2].result.resolve([RENT]);
        await names.loaded;
        expect(offered('re')).toEqual(['Rent']);
        expect(offered('fo')).toEqual([]);

        names.open(undefined);
        expect(names.bookId).toBeUndefined();
        expect(offered('re')).toEqual([]);
        names.refresh();
        expect(loads).toHaveLength(3);
    });

    it('drops an aborted request quietly', async () => {
        const { names, loads, errors } = setup();
        names.open('book-1');
        names.open('book-2');
        loads[0].result.reject(new DOMException('Aborted', 'AbortError'));
        await loads[0].result.promise.catch(() => undefined);
        await Promise.resolve();
        expect(errors).toEqual([]);
    });
});
