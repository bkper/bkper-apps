/**
 * The period of a request that names none: this year for activity, today for a position, and
 * the last 12 months for a trend (`defaultPeriod`). The Book's map holds no dates of movements,
 * so a Book with old data finds out from the report itself: only when the report's own answers
 * have no movements in that period does it run ONE more query, of the root of its first subject
 * over its whole history (`historyQuery`), and read the report of the last year with movements
 * it finds there instead.
 *
 * A month has movements when Bkper answers it with an amount for one of the report's groups or
 * accounts, or anything it lists under them: a month whose movements all net to zero shows
 * nothing, and counts as none. A position today always shows its balance, so it never moves.
 */
import { groupBalances, accountBalances, type QueryBalances } from './balances.js';
import { addDays, defaultPeriod, isPlausibleYear, type IsoMonth } from './periods.js';
import { historyQuery, planQueries, planReport, planSubjects, type ReportPlan } from './report.js';
import type { ReportIntent } from './report-intent.js';
import type { Snapshot } from './snapshot.js';

export interface ReadReport {
    /** The intent read: the one asked for, or with the last year with movements as its period. */
    intent: ReportIntent;
    plan: ReportPlan;
    /** The balances of every query of the plan. */
    balances: QueryBalances[];
}

/**
 * Reads the balances of a report. With `defaultPeriod` (the request named no period), a report
 * whose period has no movements reads its history with one query, and then, when it last moved
 * in an earlier year, the report of that year.
 */
export async function readReport(
    intent: ReportIntent,
    snapshot: Snapshot,
    options: {
        loadBalances: (queries: string[]) => Promise<QueryBalances[]>;
        defaultPeriod?: boolean;
    }
): Promise<ReadReport> {
    const plan = planReport(intent, snapshot);
    const balances = await options.loadBalances(planQueries(plan));
    const context = {
        nature: plan.nature,
        trend: intent.period === 'last_12_months',
        today: snapshot.today,
    };
    if (
        !options.defaultPeriod ||
        // Only this year or the last 12 months move, and only as the default of the report.
        defaultPeriod(context) !== intent.period ||
        intent.period === 'today' ||
        hasMovements(plan, snapshot, balances)
    ) {
        return { intent, plan, balances };
    }

    const [history] = await options.loadBalances([historyQuery(plan, snapshot)]);
    const period = defaultPeriod({
        ...context,
        lastActiveMonth: lastMovedMonth(plan, snapshot, history),
    });
    if (period === intent.period) {
        return { intent, plan, balances };
    }
    const moved = { ...intent, period };
    const movedPlan = planReport(moved, snapshot);
    return {
        intent: moved,
        plan: movedPlan,
        balances: await options.loadBalances(planQueries(movedPlan)),
    };
}

/** Whether the report's own answers have movements within its period. */
export function hasMovements(
    plan: ReportPlan,
    snapshot: Snapshot,
    balances: QueryBalances[]
): boolean {
    const answers = new Map(balances.map(answer => [answer.query, answer]));
    const { after, before } = plan.period.range;
    const first = after?.slice(0, 7);
    const last = addDays(before, -1).slice(0, 7);
    return planSubjects(plan, snapshot).some(({ node, root }) => {
        const query = plan.queries.find(entry => entry.root === root)?.current;
        const answer = query === undefined ? undefined : answers.get(query);
        return (
            answer !== undefined &&
            movedMonths(answer, node).some(
                month => (first === undefined || month >= first) && month <= last
            )
        );
    });
}

/**
 * The last month, in a plausible year, the report's groups and accounts under the root of
 * {@link historyQuery} had movements in.
 */
export function lastMovedMonth(
    plan: ReportPlan,
    snapshot: Snapshot,
    history: QueryBalances
): IsoMonth | undefined {
    const subjects = planSubjects(plan, snapshot);
    return subjects
        .filter(({ root }) => root === subjects[0].root)
        .flatMap(({ node }) => movedMonths(history, node))
        .filter(month => isPlausibleYear(Number(month.slice(0, 4))))
        .sort()
        .at(-1);
}

/** The months a group or account, or anything Bkper lists under it, has an amount in. */
function movedMonths(
    answer: QueryBalances,
    node: { kind: 'group' | 'account'; name: string }
): IsoMonth[] {
    const months = new Set<IsoMonth>();
    const seen = new Set<string>();
    const visit = (kind: 'group' | 'account', name: string): void => {
        const key = `${kind}:${name}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        const balances =
            kind === 'group' ? groupBalances(answer, name) : accountBalances(answer, name);
        balances?.months
            .filter(month => month.period !== '0')
            .forEach(month => months.add(month.month));
        const group = kind === 'group' ? groupBalances(answer, name) : undefined;
        group?.groups.forEach(child => visit('group', child));
        group?.accounts.forEach(child => visit('account', child));
    };
    visit(node.kind, node.name);
    return [...months];
}
