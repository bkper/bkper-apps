/**
 * The balances of one Bkper query, as Bkper returns them: for each group and account in the
 * response, its balance in the query's period, its cumulative balance at the query's `before`,
 * and its monthly balances (`by:m`). Amounts are decimal strings with the sign Bkper shows
 * people: bkper-js representative balances, by credit nature.
 *
 * Nothing here adds amounts up: a report reads each amount it shows from one of these.
 * Entries are by Bkper name, which is unique per Book for groups and for accounts, so the
 * result does not depend on the Book map it is later read with.
 */
import type { Amount, BalancesContainer, BalancesReport } from 'bkper-js';
import { isoMonth, type IsoMonth } from './periods.js';

/** One monthly bucket of a balances query. */
export interface MonthBalance {
    month: IsoMonth;
    /** Activity within the month (and the query's period). */
    period: string;
    /** Position at the end of the month, or at the query's `before` for its last month. */
    cumulative: string;
}

/** The balances of one group or account in a query. */
export interface NodeBalances {
    /** Activity within the query's period: `after:` (if any) to `before:`. */
    period: string;
    /** Position at the query's `before:`. */
    cumulative: string;
    /**
     * Bkper's monthly buckets, ascending. They are sparse: a month after the last one with
     * movements, or before the first one of a query without `after:`, has no bucket.
     */
    months: MonthBalance[];
}

export interface QueryBalances {
    /** The exact Bkper query. */
    query: string;
    /** When Bkper answered it, as an ISO instant. */
    dataAt: string;
    groups: Record<string, NodeBalances>;
    accounts: Record<string, NodeBalances>;
}

/** Reads the response to a balances query. */
export function readQueryBalances(
    query: string,
    report: BalancesReport,
    dataAt: Date
): QueryBalances {
    const balances: QueryBalances = {
        query,
        dataAt: dataAt.toISOString(),
        groups: {},
        accounts: {},
    };
    const read = (container: BalancesContainer): void => {
        const entries = container.isFromAccount() ? balances.accounts : balances.groups;
        // An account in several groups comes with the same balances under each.
        if (!Object.hasOwn(entries, container.getName())) {
            entries[container.getName()] = nodeBalances(container);
        }
        container.getBalancesContainers().forEach(read);
    };
    report.getBalancesContainers().forEach(read);
    return balances;
}

function nodeBalances(container: BalancesContainer): NodeBalances {
    return {
        period: decimal(container.getPeriodBalance()),
        cumulative: decimal(container.getCumulativeBalance()),
        months: container
            .getBalances()
            .map(balance => ({
                month: isoMonth(balance.getYear(), balance.getMonth()),
                period: decimal(balance.getPeriodBalance()),
                cumulative: decimal(balance.getCumulativeBalance()),
            }))
            .sort((a, b) => a.month.localeCompare(b.month)),
    };
}

/** The balances of a group or an account by name; `undefined` when Bkper left it out. */
export function groupBalances(balances: QueryBalances, name: string): NodeBalances | undefined {
    return Object.hasOwn(balances.groups, name) ? balances.groups[name] : undefined;
}

export function accountBalances(balances: QueryBalances, name: string): NodeBalances | undefined {
    return Object.hasOwn(balances.accounts, name) ? balances.accounts[name] : undefined;
}

/** Activity within a month: its bucket's, or zero for a month without one. */
export function monthPeriod(node: NodeBalances | undefined, month: IsoMonth): string {
    return node?.months.find(entry => entry.month === month)?.period ?? '0';
}

/**
 * Position at the end of a month: the cumulative balance of its bucket, or of the last bucket
 * before it, since Bkper leaves out months without movements; zero before the first bucket.
 */
export function monthPosition(node: NodeBalances | undefined, month: IsoMonth): string {
    return node?.months.filter(entry => entry.month <= month).at(-1)?.cumulative ?? '0';
}

/** Plain decimal notation; zero has no sign. */
function decimal(amount: Amount): string {
    return amount.eq(0) ? '0' : amount.toFixed();
}
