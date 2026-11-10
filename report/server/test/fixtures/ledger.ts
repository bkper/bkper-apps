/**
 * A made-up ledger that answers balances queries the way the Bkper API does, from its
 * transactions, so tests can ask for any period without recording a payload per query.
 *
 * Each transaction moves an amount from one account to another: the `from` account's raw
 * balance (credit minus debit) goes up, the `to` account's goes down, so the ledger always
 * adds up to zero. A query reads one group or account, with an optional hashtag (two or more
 * filter nothing, as in Bkper), and the dates
 * the app writes (`on:`, `after:`, `before:`, then `by:m`), resolved from the ledger's today as
 * Bkper resolves them (`resolveQueryDates`): bare `$y`, `$m` and `$d+1`, and ISO `yyyy` and
 * `yyyy-mm`. `after:` is inclusive, `before:` exclusive.
 *
 * Like Bkper, monthly buckets are sparse: a query with `after:` has a bucket for its first
 * month (carrying the position before it) and for every month up to the last one with
 * movements; a query without one, only the months with movements and the month of `before:`
 * itself, which Bkper lists too, even after the range. Cumulative balances always count every movement
 * before `before`, whatever `after:` says; with hashtags and `after:`, they start from the
 * balance at `after:` of every movement, with or without the hashtags, as Bkper's do. The
 * answer carries the range and its labels in the Book's date format, as Bkper writes them.
 */
import { Amount } from 'bkper-js';
import { resolveQueryDates } from '../../src/services/period-query';

export interface LedgerTransaction {
    /** `YYYY-MM-DD`, in the Book time zone. */
    date: string;
    from: string;
    to: string;
    /** A positive decimal. */
    amount: string;
    hashtags?: string[];
}

interface BalancesQuery {
    kind: 'group' | 'account';
    name: string;
    hashtags: string[];
    after?: string;
    before: string;
}

interface Movement {
    date: string;
    raw: Amount;
    /** Whether the transaction has the query's hashtags. */
    tagged: boolean;
}

export class FakeLedger {
    /** Every query asked, in order. */
    readonly queries: string[] = [];

    /**
     * @param today The Book's today, `YYYY-MM-DD`, from which query dates are resolved; a test
     *   may move it.
     */
    constructor(
        readonly book: bkper.Book,
        readonly transactions: LedgerTransaction[],
        public today: string
    ) {}

    /** The Bkper API's payload of a balances query. */
    balances(query: string): bkper.Balances {
        this.queries.push(query);
        const parsed = parseQuery(query, this.today);
        const dates = rangeOf(parsed, this.book.datePattern ?? 'dd/MM/yyyy');
        if (parsed.kind === 'account') {
            const account = this.account(parsed.name);
            return {
                periodicity: 'MONTHLY',
                ...dates,
                accountBalances: [this.accountBalances(account, parsed)],
            };
        }
        const group = this.group(parsed.name);
        return {
            periodicity: 'MONTHLY',
            ...dates,
            groupBalances: [this.groupBalances(group, parsed)],
        };
    }

    /** Adds an account to the Book, in the given groups. */
    addAccount(account: {
        id: string;
        name: string;
        type: NonNullable<bkper.Account['type']>;
        groups: string[];
    }): void {
        this.book.accounts = [
            ...(this.book.accounts ?? []),
            {
                id: account.id,
                name: account.name,
                normalizedName: account.name.toLowerCase(),
                type: account.type,
                credit: account.type === 'LIABILITY' || account.type === 'INCOMING',
                permanent: account.type === 'ASSET' || account.type === 'LIABILITY',
                archived: false,
                hasTransactionPosted: true,
                groups: account.groups.map(id => ({ id })),
            },
        ];
    }

    /** Adds a group to the Book, with existing accounts in it. */
    addGroup(group: bkper.Group, accounts: string[] = []): void {
        this.book.groups = [...(this.book.groups ?? []), group];
        for (const account of this.book.accounts ?? []) {
            if (accounts.includes(account.id ?? '')) {
                account.groups = [...(account.groups ?? []), { id: group.id }];
            }
        }
    }

    /** Renames an account, in the Book and in its transactions. */
    renameAccount(id: string, name: string): void {
        const account = this.book.accounts?.find(candidate => candidate.id === id);
        if (!account?.name) {
            throw new Error(`No account ${id}`);
        }
        const old = account.name;
        account.name = name;
        account.normalizedName = name.toLowerCase();
        for (const transaction of this.transactions) {
            transaction.from = transaction.from === old ? name : transaction.from;
            transaction.to = transaction.to === old ? name : transaction.to;
        }
    }

    /** Removes a group from the Book, and its accounts from it. */
    removeGroup(id: string): void {
        this.book.groups = (this.book.groups ?? []).filter(group => group.id !== id);
        for (const account of this.book.accounts ?? []) {
            account.groups = account.groups?.filter(ref => ref.id !== id);
        }
    }

    private group(name: string): bkper.Group {
        const group = this.book.groups?.find(candidate => candidate.name === name);
        if (!group) {
            throw new Error(`No group ${name} in the ledger`);
        }
        return group;
    }

    private account(name: string): bkper.Account {
        const account = this.book.accounts?.find(candidate => candidate.name === name);
        if (!account) {
            throw new Error(`No account ${name} in the ledger`);
        }
        return account;
    }

    private groupBalances(group: bkper.Group, query: BalancesQuery): bkper.GroupBalances {
        const children = (this.book.groups ?? []).filter(child => child.parent?.id === group.id);
        const accounts = (this.book.accounts ?? []).filter(account =>
            account.groups?.some(ref => ref.id === group.id)
        );
        const movements = this.descendants(group).flatMap(account =>
            this.movements(account, query)
        );
        return {
            name: group.name,
            normalizedName: group.normalizedName,
            credit: group.credit,
            permanent: group.permanent,
            ...totals(movements, query),
            ...(children.length > 0
                ? { groupBalances: children.map(child => this.groupBalances(child, query)) }
                : {}),
            accountBalances: accounts.map(account => this.accountBalances(account, query)),
        };
    }

    private accountBalances(account: bkper.Account, query: BalancesQuery): bkper.AccountBalances {
        const movements = this.movements(account, query);
        return {
            name: account.name,
            normalizedName: account.normalizedName,
            credit: account.credit,
            permanent: account.permanent,
            archived: account.archived,
            empty: movements.length === 0,
            ...totals(movements, query),
        };
    }

    /** The accounts of a group and of its subgroups, each once. */
    private descendants(group: bkper.Group): bkper.Account[] {
        const ids = new Set<string>();
        const collect = (id: string): void => {
            ids.add(id);
            (this.book.groups ?? [])
                .filter(child => child.parent?.id === id)
                .forEach(child => collect(child.id ?? ''));
        };
        collect(group.id ?? '');
        return (this.book.accounts ?? []).filter(account =>
            account.groups?.some(ref => ids.has(ref.id ?? ''))
        );
    }

    /** The raw movements of an account before the query's `before`. */
    private movements(account: bkper.Account, query: BalancesQuery): Movement[] {
        return this.transactions
            .filter(transaction => transaction.date < query.before)
            .flatMap(transaction => {
                const raw = new Amount(transaction.amount);
                // Bkper filters by a hashtag only when the query has exactly one.
                const tagged =
                    query.hashtags.length !== 1 ||
                    (transaction.hashtags ?? []).includes(query.hashtags[0]);
                return [
                    ...(transaction.from === account.name
                        ? [{ date: transaction.date, raw, tagged }]
                        : []),
                    ...(transaction.to === account.name
                        ? [{ date: transaction.date, raw: raw.times(-1), tagged }]
                        : []),
                ];
            });
    }
}

function totals(
    all: Movement[],
    query: BalancesQuery
): Pick<bkper.GroupBalances, 'balances' | 'periodBalance' | 'cumulativeBalance'> {
    const after = query.after;
    const inRange = all.filter(m => m.tagged && (after === undefined || m.date >= after));
    // Before `after:`, Bkper counts every movement, hashtags or not.
    const counted = [...all.filter(m => after !== undefined && m.date < after), ...inRange];
    return {
        balances: buckets(counted, inRange, query),
        periodBalance: sum(inRange).toFixed(),
        cumulativeBalance: sum(counted).toFixed(),
    };
}

function buckets(counted: Movement[], inRange: Movement[], query: BalancesQuery): bkper.Balance[] {
    const moved = [...new Set(inRange.map(m => m.date.slice(0, 7)))].sort();
    let listed: string[] = [];
    if (query.after !== undefined) {
        const first = query.after.slice(0, 7);
        for (let month = first; month <= (moved.at(-1) ?? first); month = nextMonth(month)) {
            listed.push(month);
        }
    } else if (moved.length > 0) {
        // Without `after:`, Bkper also lists the month of `before:`, even after the range.
        listed = [...new Set([...moved, query.before.slice(0, 7)])].sort();
    }
    const balances: bkper.Balance[] = [];
    for (const month of listed) {
        const moves = inRange.filter(m => m.date.startsWith(month));
        const period = sum(moves);
        const [year, monthOfYear] = month.split('-').map(Number);
        balances.push({
            year,
            month: monthOfYear,
            day: 0,
            fuzzyDate: year * 10000 + monthOfYear * 100,
            periodBalance: period.toFixed(),
            cumulativeBalance: sum(counted.filter(m => m.date.slice(0, 7) <= month)).toFixed(),
            periodCredit: sum(moves.filter(m => m.raw.gt(0))).toFixed(),
            periodDebit: sum(moves.filter(m => m.raw.lt(0)))
                .abs()
                .toFixed(),
        });
    }
    return balances;
}

function parseQuery(query: string, today: string): BalancesQuery {
    const match = /^(group|account):(?:'([^']*)'|"([^"]*)")((?: \S+)*)$/.exec(query);
    if (!match) {
        throw new Error(`The ledger does not read the query ${query}`);
    }
    const tokens = match[4].trim().split(' ').filter(Boolean);
    const dates = resolveQueryDates(
        tokens.filter(token => !token.startsWith('#')).join(' '),
        today
    );
    if (dates.last === undefined) {
        throw new Error(`The app always bounds its queries with before: ${query}`);
    }
    return {
        kind: match[1] === 'group' ? 'group' : 'account',
        name: match[2] ?? match[3],
        hashtags: tokens.filter(token => token.startsWith('#')).map(token => token.slice(1)),
        ...(dates.first === undefined ? {} : { after: `${dates.first}-01` }),
        before: dates.beforeDay ?? `${nextMonth(dates.last)}-01`,
    };
}

/** The range of a query and its labels, written in the Book's date format as Bkper writes them. */
function rangeOf(
    query: BalancesQuery,
    pattern: string
): Pick<bkper.Balances, 'range' | 'rangeBeginLabel' | 'rangeEndLabel'> {
    const write = (date: string, day: boolean) => {
        const [year, month, dayOfMonth] = date.split('-');
        const parts: Record<string, string> = { yyyy: year, MM: month, dd: dayOfMonth };
        return pattern
            .split('/')
            .filter(part => day || part !== 'dd')
            .map(part => parts[part])
            .join('/');
    };
    const daily = !query.before.endsWith('-01');
    const after = query.after === undefined ? '' : `after:${write(query.after, false)} `;
    return {
        range: ` ${after}before:${write(query.before, daily)} by:m`,
        rangeBeginLabel: query.after === undefined ? '' : write(query.after, true),
        rangeEndLabel: write(previousDay(query.before), true),
    };
}

function previousDay(date: string): string {
    const day = new Date(`${date}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() - 1);
    return day.toISOString().slice(0, 10);
}

function sum(movements: Movement[]): Amount {
    return movements.reduce((total, m) => total.plus(m.raw), new Amount(0));
}

function nextMonth(month: string): string {
    const [year, monthOfYear] = month.split('-').map(Number);
    const next = monthOfYear === 12 ? [year + 1, 1] : [year, monthOfYear + 1];
    return `${String(next[0]).padStart(4, '0')}-${String(next[1]).padStart(2, '0')}`;
}
