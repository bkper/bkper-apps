/**
 * Every combination of the parts of a period and of what it is compared with, over values that
 * stand for each kind of part (none, relative to today, named or written), that the query builder
 * accepts as of a day: span × year × month × quarter × compared year, month and quarter, or the
 * same months a year earlier.
 */
import type { IsoDate } from '../../src/services/periods';
import {
    PERIOD_SPANS,
    buildPeriodQuery,
    type ComparedParts,
    type MonthPart,
    type PeriodParts,
    type PeriodRequest,
    type QuarterPart,
    type YearPart,
} from '../../src/services/period-query';

const YEARS: readonly (YearPart | undefined)[] = [
    undefined,
    'current',
    'previous',
    'before_previous',
    2023,
];
const MONTHS: readonly (MonthPart | undefined)[] = [undefined, 3, 'current', 'previous'];
const QUARTERS: readonly (QuarterPart | undefined)[] = [undefined, 2, 'current', 'previous'];
const COMPARED_YEARS: readonly (YearPart | undefined)[] = [
    undefined,
    'current',
    'previous',
    'before_previous',
    2022,
];
const COMPARED_MONTHS: readonly (MonthPart | undefined)[] = [undefined, 1, 'current', 'previous'];
const COMPARED_QUARTERS: readonly (QuarterPart | undefined)[] = [
    undefined,
    1,
    'current',
    'previous',
];

/** An object without its `undefined` values. */
function defined<T extends object>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, part]) => part !== undefined)) as T;
}

function* periods(): Generator<PeriodParts> {
    for (const span of [undefined, ...PERIOD_SPANS]) {
        for (const year of YEARS) {
            for (const month of MONTHS) {
                for (const quarter of QUARTERS) {
                    const parts = defined({ span, year, month, quarter });
                    if (Object.keys(parts).length > 0) {
                        yield parts;
                    }
                }
            }
        }
    }
}

function* comparisons(): Generator<Pick<PeriodRequest, 'compared' | 'compareWith'>> {
    yield {};
    yield { compareWith: 'year_earlier' };
    for (const year of COMPARED_YEARS) {
        for (const month of COMPARED_MONTHS) {
            for (const quarter of COMPARED_QUARTERS) {
                const compared: ComparedParts = defined({ year, month, quarter });
                if (Object.keys(compared).length > 0) {
                    yield { compared };
                }
            }
        }
    }
}

/** Every combination the query builder reads a period of, as of `today`. */
export function periodCombinations(today: IsoDate): PeriodRequest[] {
    const requests: PeriodRequest[] = [];
    for (const period of periods()) {
        for (const comparison of comparisons()) {
            const request: PeriodRequest = { period, ...comparison };
            if (buildPeriodQuery(request, { today, nature: 'activity' }).ok) {
                requests.push(request);
            }
        }
    }
    return requests;
}
