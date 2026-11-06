import { describe, expect, it } from 'vitest';
import { AppApiError, type SavedPrompt, type SavedPromptsResponse } from '../../src/api/app-api';
import { SavedReports, type SavedReportsApi } from '../../src/state/saved-reports';

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
const WRITE = { list: true, save: true, remove: true };
const READ = { list: true, save: false, remove: false };

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
    };
    const shelf = new SavedReports(api);
    const ready = async (capabilities = WRITE) => {
        shelf.open('book-1');
        loads.at(-1)!.result.resolve({ reports: [ITEM], capabilities });
        await shelf.load();
        shelf.setSource('book-1', OTHER.prompt);
    };
    return { shelf, loads, saves, removals, ready };
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
        expect(shelf.canList).toBe(true);
        await shelf.save();
        expect(saves).toHaveLength(1);
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
    ] as const)(
        'drops late %s responses across Books (success: %s)',
        async (operation, success) => {
            const { shelf, saves, removals, loads, ready } = setup();
            await ready();
            const old = operation === 'save' ? shelf.save() : shelf.remove(ITEM.id);
            const call = operation === 'save' ? saves[0] : removals[0];
            shelf.open('book-2');
            shelf.open('book-1');
            const current = shelf.load();
            loads.at(-1)!.result.resolve({ reports: [], capabilities: READ });
            await current;
            expect(call.signal?.aborted).toBe(true);
            if (!success) call.result.reject(new AppApiError('old', 403, 'forbidden'));
            else if (operation === 'save') saves[0].result.resolve(OTHER);
            else removals[0].result.resolve();
            await old;
            expect(shelf.items).toEqual([]);
            expect(shelf.capabilities).toEqual(READ);
            expect(shelf.saveError).toBeUndefined();
            expect(shelf.removeError).toBeUndefined();
            expect(shelf.saving).toBeUndefined();
            expect(shelf.removing).toBeUndefined();
        }
    );

    it.each(['save', 'remove'] as const)(
        'prevents an old list from undoing a confirmed %s',
        async operation => {
            const { shelf, saves, removals, loads, ready } = setup();
            await ready();
            const oldLoad = shelf.load();
            const mutation = operation === 'save' ? shelf.save() : shelf.remove(ITEM.id);
            expect(loads.at(-1)!.signal?.aborted).toBe(true);
            await shelf.load();
            expect(loads).toHaveLength(2);
            if (operation === 'save') saves[0].result.resolve(OTHER);
            else removals[0].result.resolve();
            await mutation;
            loads[1].result.resolve({ reports: [ITEM], capabilities: READ });
            await oldLoad;
            expect(shelf.items).toEqual(operation === 'save' ? [ITEM, OTHER] : []);
            expect(shelf.capabilities).toEqual(WRITE);
        }
    );

    it('announces pending capability changes with the pending state already applied', async () => {
        const { shelf, saves, removals, ready } = setup();
        await ready();
        const observed: {
            saving?: string;
            removing?: string;
            canSave: boolean;
            canRemove: boolean;
        }[] = [];
        shelf.addEventListener('change', () =>
            observed.push({
                saving: shelf.saving,
                removing: shelf.removing,
                canSave: shelf.canSave,
                canRemove: shelf.canRemove,
            })
        );
        const saving = shelf.save();
        saves[0].result.resolve(OTHER);
        await saving;
        const removing = shelf.remove(ITEM.id);
        removals[0].result.resolve();
        await removing;
        expect(observed.some(state => state.saving || state.removing)).toBe(true);
        expect(
            observed
                .filter(state => state.saving || state.removing)
                .every(state => !state.canSave && !state.canRemove)
        ).toBe(true);
        expect(observed.at(-1)).toMatchObject({ canSave: true, canRemove: true });
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
