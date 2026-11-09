/**
 * A sample of every kind of period query the builder writes: each span, relative and written
 * years, named and relative months and quarters, running periods, the default comparison, the
 * same months a year earlier and named comparisons, for activity and positions, and a balance now.
 */
import {
    buildPeriodQuery,
    resolveQueryDates,
    type PeriodRequest,
    type QueryDates,
} from '../../server/src/services/period-query.ts';
import type { IsoDate, ReportNature } from '../../server/src/services/periods.ts';

/** Written years are early enough to have started on any day the check runs. */
export const PERIOD_SAMPLES: { label: string; request: PeriodRequest }[] = [
    { label: 'this month', request: { period: { span: 'month' } } },
    { label: 'last month', request: { period: { month: 'previous' } } },
    { label: 'January', request: { period: { month: 1 } } },
    { label: 'March last year', request: { period: { month: 3, year: 'previous' } } },
    { label: 'February 2016', request: { period: { month: 2, year: 2016 } } },
    { label: 'this quarter', request: { period: { quarter: 'current' } } },
    { label: 'last quarter', request: { period: { quarter: 'previous' } } },
    { label: 'Q1 2016', request: { period: { quarter: 1, year: 2016 } } },
    { label: 'this year', request: { period: { year: 'current' } } },
    { label: 'last year', request: { period: { year: 'previous' } } },
    { label: 'year before last', request: { period: { year: 'before_previous' } } },
    { label: '2023', request: { period: { year: 2023 } } },
    { label: 'year to date', request: { period: { span: 'year_to_date' } } },
    {
        label: 'last year to date',
        request: { period: { span: 'year_to_date', year: 'previous' } },
    },
    { label: 'last 12 months', request: { period: { span: 'last_12_months' } } },
    { label: 'all time', request: { period: { span: 'all_time' } } },
    { label: 'now', request: { period: { span: 'now' } } },
    {
        label: 'now vs a year ago',
        request: { period: { span: 'now' }, compareWith: 'year_earlier' },
    },
    {
        label: 'this year vs a year earlier',
        request: { period: { year: 'current' }, compareWith: 'year_earlier' },
    },
    {
        label: 'last month vs a year earlier',
        request: { period: { month: 'previous' }, compareWith: 'year_earlier' },
    },
    {
        label: 'this quarter vs a year earlier',
        request: { period: { quarter: 'current' }, compareWith: 'year_earlier' },
    },
    {
        label: 'last year vs 2023',
        request: { period: { year: 'previous' }, compared: { year: 2023 } },
    },
    { label: 'Q3 vs Q1', request: { period: { quarter: 3 }, compared: { quarter: 1 } } },
    {
        label: 'January vs January 2019',
        request: { period: { month: 1 }, compared: { year: 2019 } },
    },
    {
        label: 'this month vs last year',
        request: { period: { span: 'month' }, compared: { year: 'previous' } },
    },
];

export const NATURES: readonly ReportNature[] = ['activity', 'position'];

/** A query's dates, the samples that write them, and the months the resolver reads. */
export interface SampleQuery {
    nature: ReportNature;
    dates: string;
    resolved: QueryDates;
    /** Each sample that writes these dates, `(cmp)` when it is the comparison. */
    samples: string[];
}

/**
 * The distinct dates every sample writes as of the Book's today, for each nature, in sample
 * order; throws when a sample builds no period or no comparison.
 */
export function sampleQueries(today: IsoDate): SampleQuery[] {
    const queries = new Map<string, SampleQuery>();
    const add = (nature: ReportNature, dates: string, sample: string) => {
        const key = `${nature} ${dates}`;
        const query = queries.get(key) ?? {
            nature,
            dates,
            resolved: resolveQueryDates(dates, today),
            samples: [],
        };
        query.samples.push(sample);
        queries.set(key, query);
    };
    for (const nature of NATURES) {
        for (const { label, request } of PERIOD_SAMPLES) {
            const built = buildPeriodQuery(request, { today, nature });
            if (!built.ok) {
                throw new Error(`${label} (${nature}) builds no period: ${built.reason}`);
            }
            if (built.comparisonError) {
                throw new Error(
                    `${label} (${nature}) builds no comparison: ${built.comparisonError}`
                );
            }
            add(nature, built.period.dates, label);
            if (built.comparison) {
                add(nature, built.comparison.dates, `${label} (cmp)`);
            }
        }
    }
    return [...queries.values()];
}
