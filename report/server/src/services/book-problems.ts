/**
 * What keeps a Book from having the reports asked for, found by fixed rules from its map (no
 * balances, no AI), checked in this order:
 *
 * 1. `empty_book`: no account has transactions posted (or there are no accounts).
 * 2. `nothing_to_report`: no root groups, or more than half of the accounts with transactions
 *    posted are in no group. Reports read groups.
 * 3. `no_net_result`: a net result asked for, when no group combines Incoming and Outgoing and
 *    the activity roots cannot be netted (`netResultOf`), such as when they share accounts.
 * 4. `mixed_group`: a group read whole whose accounts with transactions posted, at any depth,
 *    hold both balances (Asset, Liability) and activity (Incoming, Outgoing). Asset with
 *    Liability, or Incoming with Outgoing, is fine.
 *
 * The first two are of the whole Book ({@link bookProblem}): every request has them, and the
 * Book shows them when Report opens. The others only for the requests that read them, when the
 * report is planned (`report.ts`). Requests the Book cannot answer for other reasons, such as
 * `not_a_report` or `future_period`, and flat but valid Books, are no problem of the Book.
 *
 * Each problem carries what a person or an agent needs to fix it, by organizing the Book's groups
 * (never its transactions): the Book's name, the names or counts involved, and whether the caller
 * may change groups ({@link canOrganize}).
 */
import { Permission } from 'bkper-js';
import type { Snapshot, SnapshotAccount, SnapshotGroup } from './snapshot.js';

interface ProblemBase {
    bookName: string;
    /** Whether the caller may change the Book's groups: OWNER or EDITOR. */
    canOrganize: boolean;
}

export type BookProblem = ProblemBase &
    (
        | { code: 'empty_book' }
        | {
              code: 'nothing_to_report';
              /** Accounts with transactions posted that are in no group. */
              ungrouped: number;
              /** Accounts with transactions posted. */
              total: number;
          }
        | {
              code: 'no_net_result';
              /** Activity root groups holding Incoming accounts, in Book order. */
              incoming: string[];
              /** Activity root groups holding Outgoing accounts, in Book order. */
              outgoing: string[];
              /** Activity root groups that share accounts with another, in Book order. */
              shared: string[];
          }
        | {
              code: 'mixed_group';
              /** The group that holds balances and activity. */
              group: string;
          }
    );

export type BookProblemCode = BookProblem['code'];

const ORGANIZE_PERMISSIONS: readonly string[] = [Permission.OWNER, Permission.EDITOR];

/** Whether a Book permission may change the Book's groups. */
export function canOrganize(permission: string): boolean {
    return ORGANIZE_PERMISSIONS.includes(permission);
}

function base(snapshot: Snapshot): ProblemBase {
    return { bookName: snapshot.book.name, canOrganize: canOrganize(snapshot.book.permission) };
}

/** The problem of the whole Book, empty or with nothing to report on, or `undefined`. */
export function bookProblem(snapshot: Snapshot): BookProblem | undefined {
    const posted = (accounts: Record<string, SnapshotAccount>) =>
        Object.values(accounts).filter(account => account.posted).length;
    const ungrouped = posted(snapshot.ungrouped);
    const total = posted(snapshot.accounts) + ungrouped;
    if (total === 0) {
        return { code: 'empty_book', ...base(snapshot) };
    }
    if (snapshot.roots.length === 0 || ungrouped * 2 > total) {
        return { code: 'nothing_to_report', ...base(snapshot), ungrouped, total };
    }
    return undefined;
}

/**
 * The Book's missing net result: its activity roots holding Incoming and Outgoing accounts, and
 * those that share accounts, from the map, or as the balances show them (`shared`).
 */
export function noNetResultProblem(snapshot: Snapshot, shared?: string[]): BookProblem {
    const activity = snapshot.roots
        .map(id => snapshot.groups[id])
        .filter(group => !group.permanent)
        .map(group => ({ group, accounts: accountsUnder(snapshot, group) }));
    const holding = (type: SnapshotAccount['type']) =>
        activity
            .filter(
                ({ group, accounts }) =>
                    group.type === type ||
                    [...accounts].some(id => snapshot.accounts[id].type === type)
            )
            .map(({ group }) => group.name);
    const sharing = activity
        .filter(({ group, accounts }) =>
            activity.some(
                other =>
                    other.group.id !== group.id && [...accounts].some(id => other.accounts.has(id))
            )
        )
        .map(({ group }) => group.name);
    return {
        code: 'no_net_result',
        ...base(snapshot),
        incoming: holding('INCOMING'),
        outgoing: holding('OUTGOING'),
        shared: shared ?? sharing,
    };
}

/**
 * The problem of reading a group whole when its accounts with transactions posted, at any depth,
 * hold both balances and activity, or `undefined`.
 */
export function mixedGroupProblem(snapshot: Snapshot, groupId: string): BookProblem | undefined {
    const group = snapshot.groups[groupId];
    const natures = new Set(
        [...accountsUnder(snapshot, group)]
            .map(id => snapshot.accounts[id])
            .filter(account => account.posted)
            .map(account => account.permanent)
    );
    return natures.size > 1
        ? { code: 'mixed_group', ...base(snapshot), group: group.name }
        : undefined;
}

/** The ids of the accounts under a group, at any depth, each once. */
function accountsUnder(snapshot: Snapshot, group: SnapshotGroup): Set<string> {
    const ids = new Set<string>();
    const collect = (node: SnapshotGroup): void => {
        node.accounts.forEach(id => ids.add(id));
        node.groups.forEach(id => collect(snapshot.groups[id]));
    };
    collect(group);
    return ids;
}
