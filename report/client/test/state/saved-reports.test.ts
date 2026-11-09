import { describe, expect, it } from 'vitest';
import { AppApiError, type SavedPrompt, type SavedPromptsResponse } from '../../src/api/app-api';
import { beforeFor, SavedReports, type SavedReportsApi } from '../../src/state/saved-reports';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
const ITEM: SavedPrompt = { id: 'a'.repeat(64), prompt: 'Expenses this year' };
const OTHER: SavedPrompt = { id: 'b'.repeat(64), prompt: 'Receitas por mês' };
const THIRD: SavedPrompt = { id: 'c'.repeat(64), prompt: 'Net result last month' };
const WRITE = { list: true, save: true, remove: true, move: true };
const READ = { list: true, save: false, remove: false, move: false };

function setup() {
    const loads: {
        book: string;
        signal?: AbortSignal;
        result: ReturnType<typeof deferred<SavedPromptsResponse>>;
    }[] = [];
    const saves: {
        book: string;
        prompt: string;
        signal?: AbortSignal;
        result: ReturnType<typeof deferred<SavedPrompt>>;
    }[] = [];
    const removals: {
        book: string;
        id: string;
        signal?: AbortSignal;
        result: ReturnType<typeof deferred<void>>;
    }[] = [];
    const moves: {
        book: string;
        id: string;
        before: string | null;
        signal?: AbortSignal;
        result: ReturnType<typeof deferred<SavedPromptsResponse>>;
    }[] = [];
    const api: SavedReportsApi = {
        savedReports: (book, options) => {
            const result = deferred<SavedPromptsResponse>();
            loads.push({ book, signal: options?.signal, result });
            return result.promise;
        },
        saveReport: (book, body, options) => {
            const result = deferred<SavedPrompt>();
            saves.push({ book, prompt: body.prompt, signal: options?.signal, result });
            return result.promise;
        },
        removeReport: (book, id, options) => {
            const result = deferred<void>();
            removals.push({ book, id, signal: options?.signal, result });
            return result.promise;
        },
        moveReport: (book, id, body, options) => {
            const result = deferred<SavedPromptsResponse>();
            moves.push({ book, id, before: body.before, signal: options?.signal, result });
            return result.promise;
        },
    };
    const shelf = new SavedReports(api);
    const ready = async (capabilities = WRITE, reports = [ITEM]) => {
        shelf.open('book-1');
        loads.at(-1)!.result.resolve({ reports, capabilities });
        await shelf.load();
        shelf.setSource('book-1', OTHER.prompt);
    };
    /** A shelf of three, in the server's order, which is not the order of their ids. */
    const three = () => ready(WRITE, [THIRD, ITEM, OTHER]);
    return { shelf, loads, saves, removals, moves, ready, three };
}

describe('SavedReports', () => {
    it('loads a Book-shared shelf and fails closed until capabilities arrive', async () => {
        const { shelf, loads } = setup();
        expect(shelf.canSave).toBe(false);
        shelf.open('book-1');
        expect(shelf.loading).toBe(true);
        expect(shelf.canRemove).toBe(false);
        const same = shelf.load();
        expect(loads).toHaveLength(1);
        loads[0].result.resolve({ reports: [ITEM], capabilities: READ });
        await same;
        expect(shelf.items).toEqual([ITEM]);
        expect(shelf.canList).toBe(true);
        expect(shelf.canSave).toBe(false);
        expect(shelf.canRemove).toBe(false);
        expect(shelf.loading).toBe(false);
    });

    it('saves only the shown source, coalesces duplicate clicks and merges identical ids', async () => {
        const { shelf, saves, ready } = setup();
        await ready();
        const first = shelf.save();
        const second = shelf.save();
        expect(first).toBe(second);
        expect(shelf.saving).toBe(OTHER.prompt);
        expect(saves).toHaveLength(1);
        expect(saves[0]).toMatchObject({ book: 'book-1', prompt: OTHER.prompt });
        expect(shelf.items).toEqual([ITEM]);
        saves[0].result.resolve(OTHER);
        await first;
        expect(shelf.items).toEqual([ITEM, OTHER]);
        expect(shelf.saving).toBeUndefined();
        expect(shelf.isSaved(OTHER.prompt)).toBe(true);
        await shelf.save();
        expect(saves).toHaveLength(1);
        shelf.setSource('book-2', 'Wrong Book');
        expect(shelf.canSave).toBe(false);
        await shelf.save();
        expect(saves).toHaveLength(1);
    });

    it('removes after success, coalesces duplicate clicks and leaves items intact on failure', async () => {
        const { shelf, removals, ready } = setup();
        await ready();
        const first = shelf.remove(ITEM.id);
        expect(shelf.remove(ITEM.id)).toBe(first);
        expect(shelf.removing).toBe(ITEM.id);
        expect(shelf.items).toEqual([ITEM]);
        removals[0].result.reject(new AppApiError('private', 502, 'storage_error'));
        await first;
        expect(shelf.removeError).toBe('storage_error');
        expect(shelf.items).toEqual([ITEM]);
        const retry = shelf.remove(ITEM.id);
        expect(shelf.removeError).toBeUndefined();
        removals[1].result.resolve();
        await retry;
        expect(shelf.items).toEqual([]);
        expect(shelf.removing).toBeUndefined();
    });

    it('keeps save failures separate from load failures and permits a safe retry', async () => {
        const { shelf, saves, loads, ready } = setup();
        await ready();
        const saving = shelf.save();
        saves[0].result.reject(new Error('private network details'));
        await saving;
        expect(shelf.saveError).toBe('unexpected');
        expect(shelf.items).toEqual([ITEM]);
        expect(shelf.loadError).toBeUndefined();
        const retry = shelf.save();
        saves[1].result.resolve(OTHER);
        await retry;
        expect(shelf.saveError).toBeUndefined();
        const load = shelf.load();
        loads.at(-1)!.result.reject(new AppApiError('private', 502, 'storage_error'));
        await load;
        expect(shelf.loadError).toBe('storage_error');
        expect(shelf.loading).toBe(false);
        expect(shelf.canSave).toBe(false);
        expect(shelf.items).toEqual([ITEM, OTHER]);
        const reload = shelf.load();
        loads.at(-1)!.result.resolve({ reports: [ITEM, OTHER], capabilities: WRITE });
        await reload;
        expect(shelf.loadError).toBeUndefined();
        expect(shelf.canSave).toBe(true);
    });

    it('does not trust old capabilities when the server denies a mutation', async () => {
        const { shelf, saves, ready } = setup();
        await ready();
        const saving = shelf.save();
        saves[0].result.reject(new AppApiError('private', 403, 'forbidden'));
        await saving;
        expect(shelf.saveError).toBe('forbidden');
        expect(shelf.canSave).toBe(false);
        expect(shelf.canRemove).toBe(false);
        expect(shelf.canMove).toBe(false);
        expect(shelf.canList).toBe(true);
        await shelf.save();
        expect(saves).toHaveLength(1);
    });

    it('keeps the server order and appends a confirmed save at the end', async () => {
        const { shelf, saves, ready } = setup();
        await ready(WRITE, [THIRD, ITEM, THIRD]);
        expect(shelf.items).toEqual([THIRD, ITEM]);
        const saving = shelf.save();
        saves[0].result.resolve(OTHER);
        await saving;
        expect(shelf.items).toEqual([THIRD, ITEM, OTHER]);
    });

    it('moves at once, then shows the order the server answers', async () => {
        const { shelf, moves, three } = setup();
        await three();
        const moving = shelf.move(OTHER.id, THIRD.id);
        expect(shelf.items).toEqual([OTHER, THIRD, ITEM]);
        expect(shelf.moving).toBe(OTHER.id);
        expect([shelf.canMove, shelf.canSave, shelf.canRemove]).toEqual([false, false, false]);
        expect(moves).toEqual([
            expect.objectContaining({ book: 'book-1', id: OTHER.id, before: THIRD.id }),
        ]);
        moves[0].result.resolve({ reports: [OTHER, ITEM, THIRD], capabilities: WRITE });
        await moving;
        expect(shelf.items).toEqual([OTHER, ITEM, THIRD]);
        expect(shelf.moving).toBeUndefined();
        expect(shelf.canMove).toBe(true);
        const toEnd = shelf.move(OTHER.id, null);
        expect(shelf.items).toEqual([ITEM, THIRD, OTHER]);
        expect(moves[1].before).toBeNull();
        moves[1].result.resolve({ reports: [ITEM, THIRD, OTHER], capabilities: READ });
        await toEnd;
        expect(shelf.capabilities).toEqual(READ);
        expect(shelf.canMove).toBe(false);
    });

    it('asks nothing for a move that changes nothing', async () => {
        const { shelf, moves, three } = setup();
        await three();
        await shelf.move(THIRD.id, ITEM.id);
        await shelf.move(THIRD.id, THIRD.id);
        await shelf.move(OTHER.id, null);
        await shelf.move('d'.repeat(64), null);
        await shelf.move(THIRD.id, 'd'.repeat(64));
        expect(moves).toHaveLength(0);
        expect(shelf.items).toEqual([THIRD, ITEM, OTHER]);
    });

    it('restores the previous order when a move fails, and permits a retry', async () => {
        const { shelf, moves, loads, three } = setup();
        await three();
        const moving = shelf.move(ITEM.id, THIRD.id);
        expect(shelf.items).toEqual([ITEM, THIRD, OTHER]);
        moves[0].result.reject(new AppApiError('private', 502, 'storage_error'));
        await moving;
        expect(shelf.items).toEqual([THIRD, ITEM, OTHER]);
        expect(shelf.moveError).toBe('storage_error');
        expect(shelf.moving).toBeUndefined();
        expect(loads).toHaveLength(1);
        const retry = shelf.move(ITEM.id, THIRD.id);
        expect(shelf.moveError).toBeUndefined();
        moves[1].result.resolve({ reports: [ITEM, THIRD, OTHER], capabilities: WRITE });
        await retry;
        expect(shelf.items).toEqual([ITEM, THIRD, OTHER]);
    });

    it('restores the order without an error when the transport is cancelled', async () => {
        const { shelf, moves, three } = setup();
        await three();
        const moving = shelf.move(OTHER.id, THIRD.id);
        moves[0].result.reject(new DOMException('cancelled', 'AbortError'));
        await moving;
        expect(shelf.items).toEqual([THIRD, ITEM, OTHER]);
        expect(shelf.moveError).toBeUndefined();
        expect(shelf.canMove).toBe(true);
    });

    it.each(['shelf_changed', 'report_not_found'] as const)(
        'lists the shelf again after %s',
        async code => {
            const { shelf, moves, loads, three } = setup();
            await three();
            const moving = shelf.move(ITEM.id, THIRD.id);
            const status = code === 'shelf_changed' ? 409 : 404;
            moves[0].result.reject(new AppApiError('private', status, code));
            await new Promise(resolve => setTimeout(resolve));
            expect(shelf.items).toEqual([THIRD, ITEM, OTHER]);
            expect(shelf.moveError).toBe(code);
            expect(loads).toHaveLength(2);
            loads[1].result.resolve({ reports: [ITEM, OTHER], capabilities: WRITE });
            await moving;
            expect(shelf.items).toEqual([ITEM, OTHER]);
            expect(shelf.loading).toBe(false);
            expect(shelf.canMove).toBe(true);
        }
    );

    it('turns every mutation off when the server denies a move', async () => {
        const { shelf, moves, three } = setup();
        await three();
        const moving = shelf.move(OTHER.id, THIRD.id);
        moves[0].result.reject(new AppApiError('private', 403, 'forbidden'));
        await moving;
        expect(shelf.moveError).toBe('forbidden');
        expect(shelf.items).toEqual([THIRD, ITEM, OTHER]);
        expect(shelf.capabilities).toEqual({ ...WRITE, save: false, remove: false, move: false });
        await shelf.move(OTHER.id, THIRD.id);
        expect(moves).toHaveLength(1);
    });

    it('runs one mutation at a time and coalesces a repeated move', async () => {
        const { shelf, moves, saves, removals, loads, three } = setup();
        await three();
        const moving = shelf.move(OTHER.id, THIRD.id);
        expect(shelf.move(OTHER.id, ITEM.id)).toBe(moving);
        await shelf.move(ITEM.id, null);
        await shelf.save();
        await shelf.remove(ITEM.id);
        await shelf.load();
        expect([moves.length, saves.length, removals.length, loads.length]).toEqual([1, 0, 0, 1]);
        moves[0].result.resolve({ reports: [OTHER, THIRD, ITEM], capabilities: WRITE });
        await moving;
        shelf.setSource('book-1', 'Assets today');
        const saving = shelf.save();
        await shelf.move(ITEM.id, null);
        expect(moves).toHaveLength(1);
        saves[0].result.resolve({ id: 'd'.repeat(64), prompt: 'Assets today' });
        await saving;
        expect(shelf.canMove).toBe(true);
    });

    it('gives where to move a prompt first, earlier or later', () => {
        const items = [THIRD, ITEM, OTHER];
        expect(beforeFor(items, ITEM.id, 'first')).toBe(THIRD.id);
        expect(beforeFor(items, OTHER.id, 'earlier')).toBe(ITEM.id);
        expect(beforeFor(items, THIRD.id, 'later')).toBe(OTHER.id);
        expect(beforeFor(items, ITEM.id, 'later')).toBeNull();
        expect(beforeFor(items, THIRD.id, 'first')).toBeUndefined();
        expect(beforeFor(items, THIRD.id, 'earlier')).toBeUndefined();
        expect(beforeFor(items, OTHER.id, 'later')).toBeUndefined();
        expect(beforeFor(items, 'd'.repeat(64), 'first')).toBeUndefined();
    });

    it('ignores stale loads even on A to B to A and cancels their transport', async () => {
        const { shelf, loads } = setup();
        shelf.open('a');
        shelf.open('b');
        shelf.open('a');
        const latest = shelf.load();
        expect(loads[0].signal?.aborted).toBe(true);
        expect(loads[1].signal?.aborted).toBe(true);
        loads[2].result.resolve({ reports: [OTHER], capabilities: READ });
        await latest;
        loads[0].result.resolve({ reports: [ITEM], capabilities: WRITE });
        loads[1].result.reject(new Error('late failure'));
        await Promise.resolve();
        expect(shelf.bookId).toBe('a');
        expect(shelf.items).toEqual([OTHER]);
        expect(shelf.capabilities).toEqual(READ);
        expect(shelf.loadError).toBeUndefined();
    });

    it.each([
        ['save', true],
        ['save', false],
        ['remove', true],
        ['remove', false],
        ['move', true],
        ['move', false],
    ] as const)(
        'drops late %s responses across Books (success: %s)',
        async (operation, success) => {
            const { shelf, saves, removals, moves, loads, ready } = setup();
            await ready(WRITE, [ITEM, THIRD]);
            const old =
                operation === 'save'
                    ? shelf.save()
                    : operation === 'remove'
                      ? shelf.remove(ITEM.id)
                      : shelf.move(THIRD.id, ITEM.id);
            const call =
                operation === 'save' ? saves[0] : operation === 'remove' ? removals[0] : moves[0];
            shelf.open('book-2');
            shelf.open('book-1');
            const current = shelf.load();
            loads.at(-1)!.result.resolve({ reports: [], capabilities: READ });
            await current;
            expect(call.signal?.aborted).toBe(true);
            if (!success) call.result.reject(new AppApiError('old', 403, 'forbidden'));
            else if (operation === 'save') saves[0].result.resolve(OTHER);
            else if (operation === 'remove') removals[0].result.resolve();
            else moves[0].result.resolve({ reports: [THIRD, ITEM], capabilities: WRITE });
            await old;
            expect(shelf.items).toEqual([]);
            expect(shelf.capabilities).toEqual(READ);
            expect(shelf.saveError).toBeUndefined();
            expect(shelf.removeError).toBeUndefined();
            expect(shelf.moveError).toBeUndefined();
            expect(shelf.saving).toBeUndefined();
            expect(shelf.removing).toBeUndefined();
            expect(shelf.moving).toBeUndefined();
            expect(loads).toHaveLength(3);
        }
    );

    it.each(['save', 'remove', 'move'] as const)(
        'prevents an old list from undoing a confirmed %s',
        async operation => {
            const { shelf, saves, removals, moves, loads, ready } = setup();
            await ready(WRITE, operation === 'move' ? [ITEM, OTHER] : [ITEM]);
            const oldLoad = shelf.load();
            const mutation =
                operation === 'save'
                    ? shelf.save()
                    : operation === 'remove'
                      ? shelf.remove(ITEM.id)
                      : shelf.move(OTHER.id, ITEM.id);
            expect(loads.at(-1)!.signal?.aborted).toBe(true);
            await shelf.load();
            expect(loads).toHaveLength(2);
            if (operation === 'save') saves[0].result.resolve(OTHER);
            else if (operation === 'remove') removals[0].result.resolve();
            else moves[0].result.resolve({ reports: [OTHER, ITEM], capabilities: WRITE });
            await mutation;
            loads[1].result.resolve({ reports: [ITEM, OTHER], capabilities: READ });
            await oldLoad;
            expect(shelf.items).toEqual(
                operation === 'save' ? [ITEM, OTHER] : operation === 'remove' ? [] : [OTHER, ITEM]
            );
            expect(shelf.capabilities).toEqual(WRITE);
        }
    );

    it('announces pending capability changes with the pending state already applied', async () => {
        const { shelf, saves, removals, moves, ready } = setup();
        await ready(WRITE, [ITEM, THIRD]);
        const observed: {
            pending: boolean;
            order: string;
            canSave: boolean;
            canRemove: boolean;
            canMove: boolean;
        }[] = [];
        shelf.addEventListener('change', () =>
            observed.push({
                pending: Boolean(shelf.saving || shelf.removing || shelf.moving),
                order: shelf.items.map(item => item.id[0]).join(''),
                canSave: shelf.canSave,
                canRemove: shelf.canRemove,
                canMove: shelf.canMove,
            })
        );
        const saving = shelf.save();
        saves[0].result.resolve(OTHER);
        await saving;
        const moving = shelf.move(OTHER.id, ITEM.id);
        moves[0].result.reject(new AppApiError('private', 502, 'storage_error'));
        await moving;
        const removing = shelf.remove(ITEM.id);
        removals[0].result.resolve();
        await removing;
        const pending = observed.filter(state => state.pending);
        expect(pending.length).toBeGreaterThan(0);
        expect(pending.every(state => !state.canSave && !state.canRemove && !state.canMove)).toBe(
            true
        );
        // The optimistic order and its rollback show only while the move is pending.
        expect(observed.filter(state => state.order === 'bac').every(state => state.pending)).toBe(
            true
        );
        expect(observed.at(-1)).toMatchObject({ canSave: true, canRemove: true, canMove: true });
    });

    it('gates conflicting mutations and never saves later input for an earlier output', async () => {
        const { shelf, saves, removals, ready } = setup();
        await ready();
        const saving = shelf.save();
        shelf.setSource('book-1', 'Another shown report');
        await shelf.save();
        await shelf.remove(ITEM.id);
        expect(saves).toHaveLength(1);
        expect(removals).toHaveLength(0);
        saves[0].result.resolve(OTHER);
        await saving;
        const next = shelf.save();
        expect(saves[1].prompt).toBe('Another shown report');
        saves[1].result.reject(new DOMException('cancelled', 'AbortError'));
        await next;
        expect(shelf.saveError).toBeUndefined();
        expect(shelf.saving).toBeUndefined();
    });

    it.each(['unauthorized', 'forbidden', 'book_not_found'] as const)(
        'clears shelf data on a fresh %s load failure',
        async code => {
            const { shelf, loads, ready } = setup();
            await ready();
            const reload = shelf.load();
            loads.at(-1)!.result.reject(new AppApiError('private', 403, code));
            await reload;
            expect(shelf.loadError).toBe(code);
            expect(shelf.items).toEqual([]);
            expect(shelf.canList).toBe(false);
            expect(shelf.canSave).toBe(false);
            expect(shelf.canRemove).toBe(false);
            expect(shelf.canMove).toBe(false);
        }
    );

    it('clears all Book-specific state on exit and ignores cancellation errors', async () => {
        const { shelf, loads } = setup();
        shelf.open('book-1');
        const loading = shelf.load();
        shelf.open(undefined);
        loads[0].result.reject(new DOMException('cancel', 'AbortError'));
        await loading;
        expect(shelf.bookId).toBeUndefined();
        expect(shelf.items).toEqual([]);
        expect(shelf.loading).toBe(false);
        expect(shelf.loadError).toBeUndefined();
        expect(shelf.capabilities).toBeUndefined();
    });
});
