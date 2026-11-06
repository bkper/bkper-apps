import { Permission, type Bkper } from 'bkper-js';
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
}

interface Dependencies {
    bkper: Pick<Bkper, 'getBook'>;
    kv: Pick<Env['KV'], 'get' | 'put' | 'delete' | 'list'>;
}

type Operation = keyof SavedPromptCapabilities;

export class SavedPromptsError extends Error {
    constructor(readonly reason: 'forbidden' | 'storage_error') {
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

/** Fresh, thin Book read on EVERY operation, never the balances snapshot or a cached role. */
async function authorize(bookId: string, operation: Operation, { bkper }: Dependencies) {
    const book = await bkper.getBook(bookId);
    const permission = book.getPermission();
    const canWrite = WRITE_PERMISSIONS.includes(permission);
    const capabilities: SavedPromptCapabilities = {
        list: LIST_PERMISSIONS.includes(permission),
        save: canWrite,
        remove: canWrite,
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

/** All collaborators read the same durable shelf. KV visibility is eventually consistent. */
export async function listSavedPrompts(bookId: string, dependencies: Dependencies) {
    const authorized = await authorize(bookId, 'list', dependencies);
    const reports = await stored(async () => {
        const keyPrefix = prefix(authorized.bookId);
        const items = new Map<string, SavedPrompt>();
        const cursors = new Set<string>();
        let cursor: string | undefined;
        do {
            const page = await dependencies.kv.list({
                prefix: keyPrefix,
                limit: PAGE_SIZE,
                cursor,
            });
            await Promise.all(
                page.keys.map(async key => {
                    const id = key.name.slice(keyPrefix.length);
                    if (
                        !key.name.startsWith(keyPrefix) ||
                        id.length !== 64 ||
                        !ID_PATTERN.test(id)
                    ) {
                        throw new SavedPromptsError('storage_error');
                    }
                    const value = await dependencies.kv.get(key.name);
                    // A concurrent removal may disappear between listing and reading.
                    if (value === null) return;
                    const parsed = ReportPromptSchema.safeParse(JSON.parse(value) as unknown);
                    if (
                        !parsed.success ||
                        JSON.stringify(parsed.data) !== value ||
                        (await promptId(value)) !== id
                    ) {
                        throw new SavedPromptsError('storage_error');
                    }
                    items.set(id, { id, prompt: parsed.data });
                })
            );
            if (page.list_complete) break;
            const nextCursor = page.cursor;
            if (!nextCursor || cursors.has(nextCursor)) {
                throw new SavedPromptsError('storage_error');
            }
            cursor = nextCursor;
            cursors.add(nextCursor);
        } while (true);
        return [...items.values()].sort((a, b) => a.id.localeCompare(b.id));
    });
    return { reports, capabilities: authorized.capabilities };
}

/** The route validates the prompt with ReportPromptSchema before calling this service. */
export async function savePrompt(bookId: string, prompt: string, dependencies: Dependencies) {
    const authorized = await authorize(bookId, 'save', dependencies);
    const value = JSON.stringify(prompt);
    const id = await promptId(value);
    // No TTL. Identical prompts have identical keys/values, also across collaborators.
    // Independent saves/removals cannot overwrite each other. Same-item races follow KV's
    // eventual-consistency semantics; a later save may intentionally save a removed prompt again.
    await stored(() => dependencies.kv.put(`${prefix(authorized.bookId)}${id}`, value));
    return { report: { id, prompt } };
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
