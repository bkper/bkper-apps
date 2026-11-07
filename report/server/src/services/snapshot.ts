/**
 * Book snapshot: the Book's map. Its root groups, their subgroups and accounts, their natures,
 * and the months each had movements in, which default periods, period options and
 * suggestions are chosen from. It holds no amounts: every amount a report shows comes from a
 * balances query of the report's own period (`report.ts`).
 *
 * Each root group is read with one monthly query over its full history up to today, the
 * only way Bkper tells which months had movements, and in which order it lists the children.
 */
import type { Account, BalancesContainer, BalancesReport, Book, Group } from 'bkper-js';
import {
    addDays,
    isoMonth,
    isPlausibleYear,
    type DataRange,
    type IsoDate,
    type IsoMonth,
} from './periods.js';

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
    /** The months with movements, ascending. */
    activeMonths: IsoMonth[];
}

export interface SnapshotGroup extends SnapshotNode {
    parent?: string;
    /** Subgroup ids, then account ids, each in the order Bkper returns their balances. */
    groups: string[];
    accounts: string[];
}

export interface SnapshotAccount extends SnapshotNode {
    type: Exclude<NodeType, 'MIXED'>;
    archived: boolean;
}

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
    /** First and last months with movements in any root group; absent for a Book without movements. */
    dataRange?: DataRange;
    /** Root group ids, in Book order. */
    roots: string[];
    groups: Record<string, SnapshotGroup>;
    /** Accounts by id; an account in several groups appears once. */
    accounts: Record<string, SnapshotAccount>;
}

/** The balances query of a root group over its history. */
export interface SnapshotQuery {
    root: string;
    query: string;
}

/** The queries of a snapshot: every root by month up to today. */
export function snapshotQueries(roots: { name: string }[], today: IsoDate): SnapshotQuery[] {
    const tomorrow = addDays(today, 1);
    return roots.map(root => ({
        root: root.name,
        query: `group:${quote(root.name)} before:${tomorrow} by:m`,
    }));
}

/** Bkper reads a name in single quotes, or in double quotes when it contains a single quote. */
export function quote(name: string): string {
    return name.includes("'") ? `"${name}"` : `'${name}'`;
}

export interface SnapshotResult {
    query: SnapshotQuery;
    report: BalancesReport;
}

export interface SnapshotInput {
    /** The Book, with its groups and accounts already loaded. */
    book: Book;
    groups: Group[];
    accounts: Account[];
    /** The results of {@link snapshotQueries}, in query order. */
    results: SnapshotResult[];
    today: IsoDate;
    dataAt: Date;
}

/** Normalizes a Book and the results of its {@link snapshotQueries} into a snapshot. */
export function buildSnapshot(input: SnapshotInput): Snapshot {
    const { book, results } = input;
    const lookup = new Lookup(input.groups, input.accounts);
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
    };
    const active = new Set<IsoMonth>();

    for (const { report } of results) {
        for (const container of report.getBalancesContainers()) {
            if (container.isFromAccount()) {
                continue;
            }
            const root = addGroup(snapshot, lookup, container, undefined);
            snapshot.roots.push(root);
            for (const month of snapshot.groups[root].activeMonths) {
                if (isPlausibleYear(Number(month.slice(0, 4)))) {
                    active.add(month);
                }
            }
        }
    }

    const months = [...active].sort();
    if (months.length > 0) {
        snapshot.dataRange = {
            firstMonth: months[0],
            lastMonth: months[months.length - 1],
            activeMonths: months,
        };
    }
    return snapshot;
}

function addGroup(
    snapshot: Snapshot,
    lookup: Lookup,
    container: BalancesContainer,
    parent: string | undefined
): string {
    const group = lookup.group(container.getName());
    const id = group.getId() ?? '';
    let node = snapshot.groups[id];
    if (!node) {
        node = {
            id,
            name: container.getName(),
            // Like Bkper charts, a group without one account type is mixed.
            type: group.isMixed() || !group.getType() ? 'MIXED' : group.getType(),
            credit: container.isCredit() ?? false,
            permanent: container.isPermanent(),
            ...(parent === undefined ? {} : { parent }),
            groups: [],
            accounts: [],
            activeMonths: activeMonths(container),
        };
        snapshot.groups[id] = node;
    }

    for (const child of container.getBalancesContainers()) {
        if (child.isFromAccount()) {
            addOnce(node.accounts, addAccount(snapshot, lookup, child));
        } else {
            addOnce(node.groups, addGroup(snapshot, lookup, child, id));
        }
    }
    return id;
}

function addAccount(snapshot: Snapshot, lookup: Lookup, container: BalancesContainer): string {
    const account = lookup.account(container.getName());
    const id = account.getId() ?? '';
    let node = snapshot.accounts[id];
    if (!node) {
        node = {
            id,
            name: container.getName(),
            type: account.getType(),
            credit: container.isCredit() ?? false,
            permanent: container.isPermanent(),
            archived: account.isArchived() ?? false,
            activeMonths: activeMonths(container),
        };
        snapshot.accounts[id] = node;
    }
    return id;
}

/** The months a group or an account had movements in: debits or credits, even if they net to zero. */
function activeMonths(container: BalancesContainer): IsoMonth[] {
    return container
        .getBalances()
        .filter(balance => !balance.getPeriodDebit().eq(0) || !balance.getPeriodCredit().eq(0))
        .map(balance => isoMonth(balance.getYear(), balance.getMonth()))
        .sort();
}

function addOnce(ids: string[], id: string): void {
    if (!ids.includes(id)) {
        ids.push(id);
    }
}

/** Finds groups and accounts by the names in balances, without further API calls. */
class Lookup {
    private readonly groups: Map<string, Group>;
    private readonly accounts: Map<string, Account>;

    constructor(groups: Group[], accounts: Account[]) {
        this.groups = new Map(groups.map(group => [group.getName() ?? '', group]));
        this.accounts = new Map(accounts.map(account => [account.getName() ?? '', account]));
    }

    group(name: string): Group {
        const group = this.groups.get(name);
        if (!group) {
            throw new Error(`Group not found in the Book: ${name}`);
        }
        return group;
    }

    account(name: string): Account {
        const account = this.accounts.get(name);
        if (!account) {
            throw new Error(`Account not found in the Book: ${name}`);
        }
        return account;
    }
}

/** The last month any of the nodes had movements; `undefined` when none ever had. */
export function lastActiveMonth(nodes: SnapshotNode[]): IsoMonth | undefined {
    return nodes
        .flatMap(node => node.activeMonths)
        .sort()
        .at(-1);
}
