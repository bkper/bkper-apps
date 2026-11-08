/**
 * Book snapshot: the Book's map. Its root groups, their subgroups and accounts, their natures,
 * and which accounts have transactions posted, which Jev's options, names, net results,
 * suggestions and the Book's problems (`book-problems.ts`) are chosen from. It holds no amounts
 * and no dates of movements: every amount a report shows comes from a balances query of the
 * report's own period (`report.ts`).
 *
 * It is built from the Book's structure alone, as one `getBook` call returns it with its groups
 * and accounts: no balances query, so its cost does not grow with the Book's history or its
 * number of root groups. Root groups keep the order of the Book's payload; the subgroups and
 * accounts under a group are by name ({@link byName}), as Bkper lists them in balances.
 */
import type { Account, Book, Group } from 'bkper-js';
import type { IsoDate } from './periods.js';

/** Group nature: an account type, or mixed (Asset with Liability, Incoming with Outgoing). */
export type NodeType = 'ASSET' | 'LIABILITY' | 'INCOMING' | 'OUTGOING' | 'MIXED';

export interface SnapshotNode {
    id: string;
    name: string;
    type: NodeType;
    /** Credit nature (Incoming, Liability): decides the sign Bkper shows. */
    credit: boolean;
    /** Position to a date (Asset, Liability) rather than activity in a period. */
    permanent: boolean;
}

export interface SnapshotGroup extends SnapshotNode {
    parent?: string;
    /** Subgroup ids, then account ids, each by name (see {@link byName}), as Bkper lists balances. */
    groups: string[];
    accounts: string[];
}

export interface SnapshotAccount extends SnapshotNode {
    type: Exclude<NodeType, 'MIXED'>;
    archived: boolean;
    /** Whether a transaction was ever posted to it, as Bkper tells in the Book payload. */
    posted: boolean;
}

/** An account in no group: a root of its own, which a report reads with a query of its own. */
export type UngroupedAccount = SnapshotAccount;

export interface Snapshot {
    book: {
        id: string;
        name: string;
        timeZone?: string;
        /** Decimal places the Book shows. */
        fractionDigits?: number;
        permission: string;
    };
    /** The Book's today when the map was read; every period of a report is relative to it. */
    today: IsoDate;
    /** When the map was read, as an ISO instant. */
    dataAt: string;
    /** Root group ids, in Book order: the order of the Book's payload. */
    roots: string[];
    groups: Record<string, SnapshotGroup>;
    /** Accounts in groups, by id; an account in several groups appears once. */
    accounts: Record<string, SnapshotAccount>;
    /** Accounts in no group, by id. */
    ungrouped: Record<string, UngroupedAccount>;
}

/** Bkper reads a name in single quotes, or in double quotes when it contains a single quote. */
export function quote(name: string): string {
    return name.includes("'") ? `"${name}"` : `'${name}'`;
}

export interface SnapshotInput {
    /** The Book, with its groups and accounts already loaded. */
    book: Book;
    groups: Group[];
    accounts: Account[];
    today: IsoDate;
    dataAt: Date;
}

/** By name, ignoring case, as Bkper lists the groups and accounts under a group in balances. */
export function byName(a: { name: string }, b: { name: string }): number {
    return compare(a.name.toLowerCase(), b.name.toLowerCase()) || compare(a.name, b.name);
}

/** By code point, so every runtime orders alike. */
function compare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Normalizes a Book's groups and accounts into a snapshot: root groups in the payload's order,
 * subgroups under their parents and accounts under the groups each lists, by name. It makes no
 * request.
 */
export function buildSnapshot(input: SnapshotInput): Snapshot {
    const { book } = input;
    const named = <T extends Group | Account>(items: T[]) =>
        items
            .map(item => ({ item, name: item.getName() ?? '' }))
            .sort(byName)
            .map(({ item }) => item);
    const snapshot: Snapshot = {
        book: {
            id: book.getId() ?? '',
            name: book.getName() ?? '',
            timeZone: book.getTimeZone(),
            fractionDigits: book.getFractionDigits(),
            permission: book.getPermission(),
        },
        today: input.today,
        dataAt: input.dataAt.toISOString(),
        roots: [],
        groups: {},
        accounts: {},
        ungrouped: {},
    };

    const known = new Set(input.groups.map(group => group.getId() ?? ''));
    for (const group of input.groups) {
        const id = group.getId() ?? '';
        const parentId = group.getParent()?.getId();
        const parent = parentId !== undefined && known.has(parentId) ? parentId : undefined;
        snapshot.groups[id] = {
            id,
            name: group.getName() ?? '',
            // Like Bkper charts, a group without one account type is mixed.
            type: group.isMixed() || !group.getType() ? 'MIXED' : group.getType(),
            credit: group.isCredit() ?? false,
            permanent: group.isPermanent() ?? false,
            ...(parent === undefined ? {} : { parent }),
            groups: [],
            accounts: [],
        };
    }
    // Object keys that look like small integers do not keep their order: walk the lists.
    for (const group of input.groups) {
        const id = group.getId() ?? '';
        if (snapshot.groups[id].parent === undefined) {
            snapshot.roots.push(id);
        }
    }
    for (const group of named(input.groups)) {
        const { id, parent } = snapshot.groups[group.getId() ?? ''];
        if (parent !== undefined) {
            snapshot.groups[parent].groups.push(id);
        }
    }

    for (const account of named(input.accounts)) {
        const node = accountNode(account);
        // The Book payload lists each account's groups, so this needs no further request.
        const groups = (account.json().groups ?? [])
            .map(ref => (ref.id === undefined ? undefined : snapshot.groups[ref.id]))
            .filter(group => group !== undefined);
        if (groups.length === 0) {
            snapshot.ungrouped[node.id] = node;
            continue;
        }
        snapshot.accounts[node.id] = node;
        for (const group of groups) {
            if (!group.accounts.includes(node.id)) {
                group.accounts.push(node.id);
            }
        }
    }
    return snapshot;
}

function accountNode(account: Account): SnapshotAccount {
    return {
        id: account.getId() ?? '',
        name: account.getName() ?? '',
        type: account.getType(),
        credit: account.isCredit() ?? false,
        permanent: account.isPermanent() ?? false,
        archived: account.isArchived() ?? false,
        posted: account.hasTransactionPosted() ?? false,
    };
}
