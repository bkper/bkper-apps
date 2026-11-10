import { Permission, type Bkper } from 'bkper-js';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import type { Env } from '../../../env.js';
import { ReportPromptSchema } from './report-prompt.js';

export interface SavedPrompt {
    id: string;
    prompt: string;
}

export interface SavedPromptCapabilities {
    list: boolean;
    save: boolean;
    remove: boolean;
    move: boolean;
}

interface Dependencies {
    bkper: Pick<Bkper, 'getBook'>;
    kv: Pick<Env['KV'], 'get' | 'put' | 'delete' | 'list'>;
}

type Operation = keyof SavedPromptCapabilities;

export class SavedPromptsError extends Error {
    constructor(
        readonly reason: 'forbidden' | 'storage_error' | 'prompt_not_found' | 'shelf_changed'
    ) {
        super(reason);
        this.name = 'SavedPromptsError';
    }
}

// SavedQueryController.list -> Authorizer.assertCollaboratorOn accepts every non-NONE
// role, including RECORDER. Save/delete explicitly allow only OWNER and EDITOR.
// Native save's owner-plan billing restriction is not a role permission and is not
// inherited by this app-owned metadata. Never infer the owner's plan from the caller.
const LIST_PERMISSIONS: readonly Permission[] = [
    Permission.OWNER,
    Permission.EDITOR,
    Permission.POSTER,
    Permission.RECORDER,
    Permission.VIEWER,
];
const WRITE_PERMISSIONS: readonly Permission[] = [Permission.OWNER, Permission.EDITOR];
const ID_PATTERN = /^[a-f0-9]{64}$/;
const PAGE_SIZE = 100;
/** The alphabet of `fractional-indexing`'s default keys, such as `a0` or `Zz`. */
const POSITION_PATTERN = /^[A-Za-z][0-9A-Za-z]*$/;

/** Fresh, thin Book read on EVERY operation, never the balances snapshot or a cached role. */
async function authorize(bookId: string, operation: Operation, { bkper }: Dependencies) {
    const book = await bkper.getBook(bookId);
    const permission = book.getPermission();
    const canWrite = WRITE_PERMISSIONS.includes(permission);
    const capabilities: SavedPromptCapabilities = {
        list: LIST_PERMISSIONS.includes(permission),
        save: canWrite,
        remove: canWrite,
        move: canWrite,
    };
    if (!capabilities[operation]) throw new SavedPromptsError('forbidden');
    return { bookId: book.getId(), capabilities };
}

/** A separate key per item, not a read/modify/write of Book properties or a shelf list. */
function prefix(bookId: string): string {
    return `saved-prompts:v1:${encodeURIComponent(bookId)}:`;
}

/** JSON encoding also distinguishes lone UTF-16 surrogates from the replacement character. */
async function promptId(encodedPrompt: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encodedPrompt));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** KV failures must not expose stored prompts, keys or upstream details through the API/logs. */
async function stored<T>(operation: () => Promise<T>): Promise<T> {
    try {
        return await operation();
    } catch {
        throw new SavedPromptsError('storage_error');
    }
}

/** A prompt's key on the shelf, with its place: none when saved before the shelf had an order. */
interface ShelfKey {
    id: string;
    position?: string;
}

interface ShelfItem extends ShelfKey {
    prompt: string;
}

/** Only `{ position }`, a valid fractional index, or no metadata at all. Anything else is corrupt. */
function storedPosition(metadata: unknown): string | undefined {
    if (metadata === undefined || metadata === null) return undefined;
    if (typeof metadata === 'object' && !Array.isArray(metadata)) {
        const entries = Object.entries(metadata);
        const [name, position] = entries[0] ?? [];
        if (
            entries.length === 1 &&
            name === 'position' &&
            typeof position === 'string' &&
            isPosition(position)
        ) {
            return position;
        }
    }
    throw new SavedPromptsError('storage_error');
}

function isPosition(position: string): boolean {
    if (!POSITION_PATTERN.test(position)) return false;
    try {
        // Validates the key; with no upper bound it never runs out of room.
        generateKeyBetween(position, null);
        return true;
    } catch {
        return false;
    }
}

function compareIds(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The shelf's order: prompts saved before it had an order first, by id (the order they had),
 * then by position, by code unit as fractional indexes compare; equal positions, which
 * concurrent moves can give, by id.
 */
function compareShelf(a: ShelfKey, b: ShelfKey): number {
    if (a.position === b.position) return compareIds(a.id, b.id);
    if (a.position === undefined) return -1;
    if (b.position === undefined) return 1;
    return a.position < b.position ? -1 : 1;
}

function metadataOf(position: string | undefined) {
    return position === undefined ? undefined : { metadata: { position } };
}

/** Every key of the Book's shelf with its place, following every KV page. */
async function readKeys(keyPrefix: string, { kv }: Dependencies): Promise<ShelfKey[]> {
    const keys = new Map<string, ShelfKey>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
        const page = await kv.list({ prefix: keyPrefix, limit: PAGE_SIZE, cursor });
        for (const key of page.keys) {
            const id = key.name.slice(keyPrefix.length);
            if (!key.name.startsWith(keyPrefix) || id.length !== 64 || !ID_PATTERN.test(id)) {
                throw new SavedPromptsError('storage_error');
            }
            const position = storedPosition(key.metadata);
            keys.set(id, position === undefined ? { id } : { id, position });
        }
        if (page.list_complete) break;
        const nextCursor = page.cursor;
        if (!nextCursor || cursors.has(nextCursor)) {
            throw new SavedPromptsError('storage_error');
        }
        cursor = nextCursor;
        cursors.add(nextCursor);
    } while (true);
    return [...keys.values()];
}

/** The shelf in order, each prompt read and checked against its id. */
async function readShelf(keyPrefix: string, dependencies: Dependencies): Promise<ShelfItem[]> {
    const keys = await readKeys(keyPrefix, dependencies);
    const items = await Promise.all(
        keys.map(async (key): Promise<ShelfItem | undefined> => {
            const value = await dependencies.kv.get(`${keyPrefix}${key.id}`);
            // A concurrent removal may disappear between listing and reading.
            if (value === null) return undefined;
            const parsed = ReportPromptSchema.safeParse(JSON.parse(value) as unknown);
            if (
                !parsed.success ||
                JSON.stringify(parsed.data) !== value ||
                (await promptId(value)) !== key.id
            ) {
                throw new SavedPromptsError('storage_error');
            }
            return { ...key, prompt: parsed.data };
        })
    );
    return items.filter(item => item !== undefined).sort(compareShelf);
}

function promptsOf(items: readonly ShelfItem[]): SavedPrompt[] {
    return items.map(({ id, prompt }) => ({ id, prompt }));
}

/** All collaborators read the same durable shelf. KV visibility is eventually consistent. */
export async function listSavedPrompts(bookId: string, dependencies: Dependencies) {
    const authorized = await authorize(bookId, 'list', dependencies);
    const items = await stored(() => readShelf(prefix(authorized.bookId), dependencies));
    return { prompts: promptsOf(items), capabilities: authorized.capabilities };
}

/** The route validates the prompt with ReportPromptSchema before calling this service. */
export async function savePrompt(bookId: string, prompt: string, dependencies: Dependencies) {
    const authorized = await authorize(bookId, 'save', dependencies);
    const keyPrefix = prefix(authorized.bookId);
    const value = JSON.stringify(prompt);
    const id = await promptId(value);
    // No TTL. Identical prompts have identical keys/values, also across collaborators.
    // Independent saves/removals cannot overwrite each other. Same-item races follow KV's
    // eventual-consistency semantics; a later save may intentionally save a removed prompt again.
    // A prompt saved again keeps its place; a new one goes after the last. Saves made at once
    // may get the same position, ordered then by id.
    await stored(async () => {
        const keys = await readKeys(keyPrefix, dependencies);
        const existing = keys.find(key => key.id === id);
        const last = keys
            .map(key => key.position)
            .filter(position => position !== undefined)
            .sort()
            .at(-1);
        const position = existing ? existing.position : generateKeyBetween(last ?? null, null);
        const options = metadataOf(position);
        const key = `${keyPrefix}${id}`;
        await (options
            ? dependencies.kv.put(key, value, options)
            : dependencies.kv.put(key, value));
    });
    return { id, prompt };
}

/** The route validates the id. Deleting an absent item is an idempotent success. */
export async function removeSavedPrompt(
    bookId: string,
    id: string,
    dependencies: Dependencies
): Promise<void> {
    const authorized = await authorize(bookId, 'remove', dependencies);
    await stored(() => dependencies.kv.delete(`${prefix(authorized.bookId)}${id}`));
}

type Writes = [item: ShelfItem, position: string][];

/**
 * The positions to write so `id` comes just before `before` (`null`: last): first the prompts
 * saved before the shelf had an order, once, in their order, then the moved prompt (and, only
 * between equal positions, the prompts that share them from `before` on).
 */
function movePositions(items: readonly ShelfItem[], moved: ShelfItem, before: string | null) {
    const others = items.filter(item => item !== moved);
    // Unpositioned prompts lead the order, so they are the first of the others.
    const unpositioned = others.filter(item => item.position === undefined);
    const first = others[unpositioned.length]?.position ?? null;
    const normalized: Writes = generateNKeysBetween(null, first, unpositioned.length).map(
        (position, index) => [unpositioned[index], position]
    );
    const positions = [
        ...normalized.map(([, position]) => position),
        ...others.slice(unpositioned.length).flatMap(item => item.position ?? []),
    ];
    const index = before === null ? others.length : others.findIndex(item => item.id === before);
    const lower = positions[index - 1] ?? null;
    const upper = positions[index] ?? null;
    if (lower === null || upper === null || lower < upper) {
        return { normalized, placed: [[moved, generateKeyBetween(lower, upper)]] satisfies Writes };
    }
    // Between equal positions: the moved prompt goes after them, and the ones that share it
    // from `before` on go after the moved one, before the next position.
    let end = index;
    while (positions[end] === lower) end++;
    const next = positions[end] ?? null;
    const position = generateKeyBetween(lower, next);
    const placed: Writes = [
        [moved, position],
        ...generateNKeysBetween(position, next, end - index).map((key, offset): Writes[number] => [
            others[index + offset],
            key,
        ]),
    ];
    return { normalized, placed };
}

/**
 * Moves a prompt just before another (`null`: to the end). The order it answers comes only
 * from this request's reads and writes: KV is eventually consistent, so a list right after
 * may not show them yet.
 */
export async function moveSavedPrompt(
    bookId: string,
    id: string,
    before: string | null,
    dependencies: Dependencies
) {
    const authorized = await authorize(bookId, 'move', dependencies);
    const keyPrefix = prefix(authorized.bookId);
    const items = await stored(() => readShelf(keyPrefix, dependencies));
    const index = items.findIndex(item => item.id === id);
    if (index === -1) throw new SavedPromptsError('prompt_not_found');
    if (before !== null && !items.some(item => item.id === before)) {
        throw new SavedPromptsError('shelf_changed');
    }
    if (before === id || (items[index + 1]?.id ?? null) === before) {
        return { prompts: promptsOf(items), capabilities: authorized.capabilities };
    }

    const { normalized, placed } = movePositions(items, items[index], before);
    // Only prompts this request read are written, with their own text, so a prompt removed
    // before it was read is not saved again.
    const write = (writes: Writes) =>
        Promise.all(
            writes.map(([item, position]) =>
                dependencies.kv.put(`${keyPrefix}${item.id}`, JSON.stringify(item.prompt), {
                    metadata: { position },
                })
            )
        );
    await stored(async () => {
        await write(normalized);
        await write(placed);
    });
    const positions = new Map([...normalized, ...placed]);
    const reordered = items
        .map(item => ({ ...item, position: positions.get(item) ?? item.position }))
        .sort(compareShelf);
    return { prompts: promptsOf(reordered), capabilities: authorized.capabilities };
}
