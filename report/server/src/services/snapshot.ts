/**
 * Book snapshot: the root groups of a Book, their subgroups and accounts, and the balances
 * every report is computed from.
 *
 * Each root group is read with one monthly query over its full history up to today, so the
 * last month holds the month to date. Roots that report activity (Incoming, Outgoing) also
 * get a few partial-month windows, which complete the comparisons of the current periods
 * (this month against the same days of last month, and so on). Amounts are decimal strings
 * with the sign Bkper shows people: bkper-js representative balances, by credit nature.
 */
import {
    Amount,
    type Account,
    type BalancesContainer,
    type BalancesReport,
    type Book,
    type Group,
} from 'bkper-js';
import {
    addDays,
    previousPeriod,
    type DataRange,
    type DateRange,
    type IsoDate,
    type IsoMonth,
} from './periods.js';

/** Group nature: an account type, or mixed (Asset with Liability, Incoming with Outgoing). */
export type NodeType = 'ASSET' | 'LIABILITY' | 'INCOMING' | 'OUTGOING' | 'MIXED';

/** Balances of one month that has movements, or the month of `before` in the query. */
export interface MonthBalance {
    month: IsoMonth;
    /** Activity within the month. */
    period: string;
    /** Position at the end of the month (at the end of today, for the current month). */
    cumulative: string;
}

/** A partial month: from the first of a month up to, not including, a later day of it. */
export interface PartialMonth {
    after: IsoDate;
    before: IsoDate;
}

/** Activity within a {@link PartialMonth}. */
export interface PartialMonthBalance extends PartialMonth {
    period: string;
}

export interface SnapshotNode {
    id: string;
    name: string;
    type: NodeType;
    /** Credit nature (Incoming, Liability): decides the sign Bkper shows. */
    credit: boolean;
    /** Position to a date (Asset, Liability) rather than activity in a period. */
    permanent: boolean;
    /** Months in ascending order; a missing month had no movement. */
    months: MonthBalance[];
    /** The comparison windows; empty outside roots that report activity. */
    windows: PartialMonthBalance[];
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
    /** The Book's today when the balances were read; every period of this snapshot is relative to it. */
    today: IsoDate;
    /** When the balances were read, as an ISO instant. */
    dataAt: string;
    /** First and last months with movements in any root group; absent for a Book without movements. */
    dataRange?: DataRange;
    /** Root group ids, in Book order. */
    roots: string[];
    groups: Record<string, SnapshotGroup>;
    /** Accounts by id; an account in several groups appears once. */
    accounts: Record<string, SnapshotAccount>;
}

/** One balances query: a root group over its history, or a root group within a window. */
export interface SnapshotQuery {
    root: string;
    query: string;
    window?: PartialMonth;
}

/** Current periods whose comparison may end in the middle of a month. */
const TO_DATE_PERIODS = ['this_month', 'this_quarter', 'this_year', 'last_12_months'] as const;

/**
 * The partial-month windows that complete the comparisons of the current periods: the
 * comparison's last month, when it ends before that month does.
 */
export function comparisonWindows(today: IsoDate): PartialMonth[] {
    const windows = new Map<string, PartialMonth>();
    for (const id of TO_DATE_PERIODS) {
        const previous = previousPeriod(id, 'activity', { today });
        if (previous && !isMonthStart(previous.before)) {
            const after = `${previous.before.slice(0, 7)}-01`;
            windows.set(after, { after, before: previous.before });
        }
    }
    return [...windows.values()];
}

/** The queries of a snapshot: every root by month up to today, plus windows for activity roots. */
export function snapshotQueries(
    roots: { name: string; permanent: boolean }[],
    today: IsoDate
): SnapshotQuery[] {
    const tomorrow = addDays(today, 1);
    const windows = comparisonWindows(today);
    return roots.flatMap(root => {
        const group = `group:${quote(root.name)}`;
        const history = { root: root.name, query: `${group} before:${tomorrow} by:m` };
        if (root.permanent) {
            return [history];
        }
        return [
            history,
            ...windows.map(window => ({
                root: root.name,
                query: `${group} after:${window.after} before:${window.before}`,
                window,
            })),
        ];
    });
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
    const windows = new Map<string, PartialMonth[]>();

    for (const { query, report } of results) {
        for (const container of report.getBalancesContainers()) {
            if (container.isFromAccount()) {
                continue;
            }
            const root = addGroup(snapshot, lookup, container, undefined, query.window);
            if (query.window) {
                windows.set(root, [...(windows.get(root) ?? []), query.window]);
                continue;
            }
            snapshot.roots.push(root);
            for (const balance of container.getBalances()) {
                if (!balance.getPeriodDebit().eq(0) || !balance.getPeriodCredit().eq(0)) {
                    active.add(monthOf(balance.getYear(), balance.getMonth()));
                }
            }
        }
    }

    for (const [root, rootWindows] of windows) {
        completeWindows(snapshot, snapshot.groups[root], rootWindows);
    }

    const months = [...active].sort();
    if (months.length > 0) {
        snapshot.dataRange = { firstMonth: months[0], lastMonth: months[months.length - 1] };
    }
    return snapshot;
}

function addGroup(
    snapshot: Snapshot,
    lookup: Lookup,
    container: BalancesContainer,
    parent: string | undefined,
    window: PartialMonth | undefined
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
            months: [],
            windows: [],
        };
        snapshot.groups[id] = node;
    }
    addBalances(node, container, window);

    for (const child of container.getBalancesContainers()) {
        if (child.isFromAccount()) {
            const accountId = addAccount(snapshot, lookup, child, window);
            addOnce(node.accounts, accountId);
        } else {
            addOnce(node.groups, addGroup(snapshot, lookup, child, id, window));
        }
    }
    return id;
}

function addAccount(
    snapshot: Snapshot,
    lookup: Lookup,
    container: BalancesContainer,
    window: PartialMonth | undefined
): string {
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
            months: [],
            windows: [],
        };
        snapshot.accounts[id] = node;
    }
    addBalances(node, container, window);
    return id;
}

/** An account under several roots gets the same balances from each query; keep the first. */
function addBalances(
    node: SnapshotNode,
    container: BalancesContainer,
    window: PartialMonth | undefined
): void {
    if (window) {
        if (!node.windows.some(w => w.after === window.after)) {
            node.windows.push({ ...window, period: decimal(container.getPeriodBalance()) });
        }
        return;
    }
    if (node.months.length > 0) {
        return;
    }
    node.months = container
        .getBalances()
        .map(balance => ({
            month: monthOf(balance.getYear(), balance.getMonth()),
            period: decimal(balance.getPeriodBalance()),
            cumulative: decimal(balance.getCumulativeBalance()),
        }))
        .sort((a, b) => a.month.localeCompare(b.month));
}

/** Bkper may leave accounts without movements out of a window: they had none in it. */
function completeWindows(snapshot: Snapshot, group: SnapshotGroup, windows: PartialMonth[]): void {
    const nodes: SnapshotNode[] = [group, ...group.accounts.map(id => snapshot.accounts[id])];
    for (const node of nodes) {
        for (const window of windows) {
            if (!node.windows.some(w => w.after === window.after)) {
                node.windows.push({ ...window, period: '0' });
            }
        }
        node.windows.sort((a, b) => b.after.localeCompare(a.after));
    }
    for (const child of group.groups) {
        completeWindows(snapshot, snapshot.groups[child], windows);
    }
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

/**
 * Activity of a node within a range, or `undefined` when the snapshot cannot answer it.
 *
 * The range must start a month (or be open). It ends at a month start, at or after
 * tomorrow (the month to date), or at the end of one of the {@link comparisonWindows}.
 * Nothing is dated after today in a snapshot.
 */
export function periodAmount(
    node: SnapshotNode,
    range: DateRange,
    snapshot: Pick<Snapshot, 'today'>
): Amount | undefined {
    const { after, before } = range;
    if (after !== undefined && !isMonthStart(after)) {
        return undefined;
    }
    const first = after?.slice(0, 7);
    const last = before.slice(0, 7);
    const inRange = (month: MonthBalance) => first === undefined || month.month >= first;
    let total = sum(node.months.filter(month => inRange(month) && month.month < last));
    if (isMonthStart(before)) {
        return total;
    }
    if (before >= addDays(snapshot.today, 1)) {
        const toDate = node.months.find(month => month.month === last);
        return toDate ? total.plus(toDate.period) : total;
    }
    const window = node.windows.find(w => w.before === before && w.after.startsWith(last));
    return window ? total.plus(window.period) : undefined;
}

/**
 * Position of a node at the start of `before`, or `undefined` when the snapshot cannot
 * answer it: `before` must start a month, or be tomorrow or later (the position today).
 */
export function positionAmount(
    node: SnapshotNode,
    before: IsoDate,
    snapshot: Pick<Snapshot, 'today'>
): Amount | undefined {
    const today = before >= addDays(snapshot.today, 1);
    if (!today && !isMonthStart(before)) {
        return undefined;
    }
    const end = before.slice(0, 7);
    const last = node.months.filter(month => today || month.month < end).at(-1);
    return new Amount(last?.cumulative ?? 0);
}

/** The last month any of the nodes had movements; `undefined` when none ever had. */
export function lastActiveMonth(nodes: SnapshotNode[]): IsoMonth | undefined {
    return nodes
        .flatMap(node => node.months)
        .filter(month => month.period !== '0')
        .map(month => month.month)
        .sort()
        .at(-1);
}

function sum(months: MonthBalance[]): Amount {
    return months.reduce((total, month) => total.plus(month.period), new Amount(0));
}

function isMonthStart(date: IsoDate): boolean {
    return date.endsWith('-01');
}

function monthOf(year: number, month: number): IsoMonth {
    return `${year}-${String(month).padStart(2, '0')}`;
}

/** Plain decimal notation; zero has no sign. */
function decimal(amount: Amount): string {
    return amount.eq(0) ? '0' : amount.toFixed();
}
