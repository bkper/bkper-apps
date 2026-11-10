import { validateReportSpec, type ReportElement, type ReportSpec } from 'report-shared/catalog';
import { isolate } from 'report-shared/bidi';
import { addAllLocales } from 'report-shared/locales';
import { addLocale, t } from 'report-shared/strings';
import { describe, expect, it } from 'vitest';
import { RELATIVE_PERIODS } from 'report-shared/report-intent';
import { reportText } from 'report-shared/report-state';
import { buildReport, planQueries, planReport, type ReportData } from '../../src/services/report';
import type { PeriodParts } from 'report-shared/report-intent';
import { reportIntentOf, type ReportIntent } from '../../src/services/report-intent';
import { buildReportSpec } from '../../src/services/report-spec';
import type { Snapshot } from '../../src/services/snapshot';
import type { FakeLedger } from '../fixtures/ledger';
import {
    fixtureLedger,
    ledgerBalances,
    ledgerSnapshot,
    simpleRootsLedger,
} from '../fixtures/snapshot-book';

/** An intent of a period id, as older intents wrote it, or of parts. */
function intent(
    root: string,
    period: string | PeriodParts,
    extra: Partial<ReportIntent> = {}
): ReportIntent {
    return reportIntentOf({ root, period, monthly: false, ...extra });
}

/** The report of an intent on a ledger (the fixture's by default), and its map unless given. */
async function report(
    request: ReportIntent,
    snapshot?: Snapshot,
    ledger: FakeLedger = fixtureLedger()
): Promise<ReportData> {
    const map = snapshot ?? (await ledgerSnapshot(ledger));
    const queries = planQueries(planReport(request, map));
    return buildReport(
        request,
        map,
        queries.map(query => ledgerBalances(ledger, query))
    );
}

async function spec(request: ReportIntent, lang = 'en', snapshot?: Snapshot, ledger?: FakeLedger) {
    return buildReportSpec(await report(request, snapshot, ledger), lang);
}

function element<T extends ReportElement['type']>(
    built: ReportSpec,
    type: T
): Extract<ReportElement, { type: T }> {
    const found = Object.values(built.elements).find(
        (candidate): candidate is Extract<ReportElement, { type: T }> => candidate.type === type
    );
    if (!found) {
        throw new Error(`No ${type} in the spec`);
    }
    return found;
}

/** Intl separates the ends of a date range with thin spaces. */
const TO = '\u2009–\u2009';

function labels(rows: { label: string; children: { label: string }[] }[]): string[] {
    return rows.flatMap(row => [row.label, ...row.children.map(child => `  ${child.label}`)]);
}

interface AmountTree {
    amount: string;
    children: AmountTree[];
}

function rowAmounts(rows: AmountTree[]): string[] {
    return rows.flatMap(row => [row.amount, ...rowAmounts(row.children)]);
}

describe('buildReportSpec', () => {
    it('builds valid specs for every kind of report and language', async () => {
        const intents = [
            intent('g-expenses', 'last_month'),
            intent('g-expenses', 'this_year', { monthly: true }),
            intent('g-expenses', 'all', { view: 'total' }),
            intent('g-expenses', '2026-Q3', { view: 'breakdown' }),
            intent('g-assets', 'today'),
            intent('g-assets', '2026-Q4', { monthly: true }),
            intent('g-card', 'last_year'),
            intent('g-net', 'this_month'),
            intent('net-result', 'last_12_months', { monthly: true }),
            intent('net-result', '2026-10'),
            intent('g-expenses', 'last_month', { chart: 'pie' }),
            intent('g-expenses', 'this_year', { chart: 'stacked' }),
            intent('g-assets', '2026-Q4', { chart: 'area' }),
            intent('net-result', 'last_12_months', { chart: 'area' }),
            intent('g-expenses', 'this_month', { chart: 'compare' }),
            intent('g-assets', 'today', { chart: 'compare' }),
            intent('net-result', 'this_month', { chart: 'waterfall' }),
            intent('g-assets', 'today', { chart: 'waterfall' }),
            intent('g-expenses', 'last_month', { chart: 'table' }),
            intent('g-net', 'last_month', { chart: 'pie' }),
        ];
        const calculated = [
            intent('net-result', 'last_12_months', { monthly: true }),
            intent('net-result', '2026-10', { chart: 'compare' }),
        ];
        for (const lang of ['en', 'pt-BR', 'ja', 'ar', 'sw', 'mni-Mtei']) {
            for (const [request, ledger] of [
                ...intents.map(request => [request, fixtureLedger()] as const),
                ...calculated.map(request => [request, simpleRootsLedger()] as const),
            ]) {
                const built = await spec(request, lang, undefined, ledger);
                const validation = validateReportSpec(built);
                expect(validation, `${lang} ${JSON.stringify(request)}`).toEqual({
                    valid: true,
                    spec: built,
                });
            }
        }
    });

    it('carries amounts and ratios as the raw decimals of the report', async () => {
        const data = await report(intent('g-assets', 'today'));
        const built = buildReportSpec(data, 'pt-BR');
        expect(element(built, 'Answer').props).toMatchObject({
            amount: '7849.25',
            previous: '3899.5',
            change: '1.0129',
            color: 'blue',
        });
        const table = element(built, 'BreakdownTable').props;
        expect(rowAmounts(table.rows)).toEqual(rowAmounts(data.breakdown));
        expect(table.rows[0]).toMatchObject({ share: '0.9873', change: '1.0395' });
        expect(element(built, 'Report').props).toMatchObject({
            locale: 'pt-BR',
            fractionDigits: 2,
        });
    });

    it('titles a whole month and compares it with the month before', async () => {
        const built = await spec(intent('g-expenses', 'last_month'));
        expect(element(built, 'Report').props).toMatchObject({
            title: 'Expenses',
            subtitle: 'October 2026',
            dir: 'ltr',
        });
        expect(element(built, 'Answer').props).toMatchObject({
            label: 'Expenses',
            comparison: `vs. ${isolate('September 2026')}`,
        });
        expect(element(built, 'Source').props).toMatchObject({
            footer: `Computed from the balances of ${isolate('Test Ledger')}`,
            period: `Oct 1${TO}31, 2026`,
            query: "group:'Expenses' on:$m-1 by:m",
        });
    });

    it('names calendar periods and the months a current period compares with', async () => {
        const quarter = await spec(intent('g-expenses', '2026-Q3'));
        expect(element(quarter, 'Report').props.subtitle).toBe(
            `Q${isolate('3')} ${isolate('2026')}`
        );
        expect(element(quarter, 'Answer').props.comparison).toBe(
            `vs. ${isolate(`Q${isolate('2')} ${isolate('2026')}`)}`
        );
        const month = await spec(intent('g-expenses', '2026-09'));
        expect(element(month, 'Report').props.subtitle).toBe('September 2026');
        const year = await spec(intent('g-expenses', '2025'));
        expect(element(year, 'Report').props.subtitle).toBe('2025');
        expect(element(year, 'Answer').props.comparison).toBe(`vs. ${isolate('2024')}`);
        const current = await spec(intent('g-expenses', 'this_year'));
        expect(element(current, 'Report').props.subtitle).toBe(`Jan${TO}Nov 2026`);
        // The same months of last year: the current month is read whole.
        expect(element(current, 'Answer').props.comparison).toBe(
            `vs. ${isolate(`Jan${TO}Nov 2025`)}`
        );
    });

    it('names the same period a year earlier when the intent compares with it', async () => {
        const yearEarlier = { compareWith: 'year_earlier' } as const;
        const month = await spec(intent('g-expenses', '2026-01', yearEarlier));
        expect(element(month, 'Report').props.subtitle).toBe('January 2026');
        expect(element(month, 'Answer').props.comparison).toBe(`vs. ${isolate('January 2025')}`);
        const current = await spec(intent('g-expenses', 'this_month', yearEarlier));
        expect(element(current, 'Answer').props.comparison).toBe(`vs. ${isolate('November 2025')}`);
        // A balance now compares with the end of the same month a year earlier.
        const position = await spec(intent('g-assets', 'today', yearEarlier));
        expect(element(position, 'Answer').props.comparison).toBe(`vs. ${isolate('Nov 30, 2025')}`);
    });

    it('dates a position and compares it with an earlier date', async () => {
        const built = await spec(intent('g-assets', 'today'));
        expect(element(built, 'Report').props.subtitle).toBe(`As of ${isolate('Nov 5, 2026')}`);
        expect(element(built, 'Answer').props.comparison).toBe(`vs. ${isolate('Oct 31, 2026')}`);
        expect(element(built, 'Source').props.period).toBe(`As of ${isolate('Nov 5, 2026')}`);
    });

    it('labels each side by the months it read, in the same form', async () => {
        const quarter = (q: string, year: string) => `Q${isolate(q)} ${isolate(year)}`;
        const forms: [ReportIntent, string, string][] = [
            [intent('g-expenses', '2025'), '2025', '2024'],
            [intent('g-expenses', '2026-10'), 'October 2026', 'September 2026'],
            [intent('g-expenses', '2026-Q3'), quarter('3', '2026'), quarter('2', '2026')],
            [intent('g-expenses', 'this_year'), `Jan${TO}Nov 2026`, `Jan${TO}Nov 2025`],
            [intent('g-expenses', 'this_quarter'), `Oct${TO}Nov 2026`, `Jul${TO}Aug 2026`],
            [
                intent('g-expenses', 'last_12_months'),
                `Dec 2025${TO}Nov 2026`,
                `Dec 2024${TO}Nov 2025`,
            ],
            [intent('g-expenses', 'this_month'), 'November 2026', 'October 2026'],
            [
                intent('g-expenses', 'this_quarter', { compareWith: 'year_earlier' }),
                `Oct${TO}Nov 2026`,
                `Oct${TO}Nov 2025`,
            ],
        ];
        for (const [request, current, previous] of forms) {
            const built = await spec({ ...request, chart: 'compare' });
            const what = request.period;
            expect(element(built, 'Report').props.subtitle, what).toBe(current);
            expect(element(built, 'Answer').props.comparison, what).toBe(
                `vs. ${isolate(previous)}`
            );
            const chart = element(built, 'Chart').props;
            expect('periods' in chart && chart.periods, what).toEqual({ current, previous });
        }
    });

    it('names a whole period of the kind asked by its name, and a running one by its months', async () => {
        const quarter = (q: string, year: string) => `Q${isolate(q)} ${isolate(year)}`;
        const at = async (today: string, request: ReportIntent) => {
            const ledger = fixtureLedger();
            ledger.today = today;
            const built = await spec({ ...request, chart: 'compare' }, 'en', undefined, ledger);
            const chart = Object.values(built.elements).find(one => one.type === 'Chart');
            const periods =
                chart?.type === 'Chart' && 'periods' in chart.props
                    ? chart.props.periods
                    : undefined;
            return {
                subtitle: element(built, 'Report').props.subtitle,
                comparison: element(built, 'Answer').props.comparison,
                periods,
            };
        };
        const forms: [string, ReportIntent, string, string][] = [
            // This year in March read three months, a range, never a quarter's name.
            [
                '2026-03-15',
                intent('g-expenses', 'this_year'),
                `Jan${TO}Mar 2026`,
                `Jan${TO}Mar 2025`,
            ],
            ['2026-03-15', intent('g-expenses', 'ytd'), `Jan${TO}Mar 2026`, `Jan${TO}Mar 2025`],
            // This quarter in March is all of it.
            [
                '2026-03-15',
                intent('g-expenses', 'this_quarter'),
                quarter('1', '2026'),
                quarter('4', '2025'),
            ],
            [
                '2026-03-15',
                intent('g-expenses', 'last_quarter'),
                quarter('4', '2025'),
                quarter('3', '2025'),
            ],
            ['2026-03-15', intent('g-expenses', 'this_month'), 'March 2026', 'February 2026'],
            [
                '2026-03-15',
                intent('g-expenses', 'last_12_months'),
                `Apr 2025${TO}Mar 2026`,
                `Apr 2024${TO}Mar 2025`,
            ],
            // In December this year is whole, while the last 12 months stay a range.
            ['2026-12-20', intent('g-expenses', 'this_year'), '2026', '2025'],
            [
                '2026-12-20',
                intent('g-expenses', 'last_12_months'),
                `Jan${TO}Dec 2026`,
                `Jan${TO}Dec 2025`,
            ],
            // A whole year compared with a quarter's months would be no name: a year earlier keeps it.
            [
                '2026-11-05',
                intent('g-expenses', 'this_quarter', { compareWith: 'year_earlier' }),
                `Oct${TO}Nov 2026`,
                `Oct${TO}Nov 2025`,
            ],
        ];
        for (const [today, request, current, previous] of forms) {
            const what = `${today} ${JSON.stringify(request.period)}`;
            const { subtitle, comparison, periods } = await at(today, request);
            expect(subtitle, what).toBe(current);
            expect(comparison, what).toBe(`vs. ${isolate(previous)}`);
            // The legend of compared parts, when the months read have any.
            if (periods) expect(periods, what).toEqual({ current, previous });
        }
    });

    it('says when the comparison asked for cannot be made, and what it compares with', async () => {
        const mismatch = await spec(
            intent('g-expenses', { span: 'year', year: 2025 }, { compared: { month: 3 } })
        );
        expect(element(mismatch, 'Report').props.notice).toBe(
            t('notice_comparison_fallback', 'en', { period: isolate('2024') })
        );
        expect(element(mismatch, 'Answer').props.comparison).toBe(`vs. ${isolate('2024')}`);
        const all = await spec(
            intent('g-expenses', { span: 'all_time' }, { compareWith: 'year_earlier' })
        );
        expect(element(all, 'Report').props.notice).toBe(t('notice_comparison_none', 'en'));
        const fine = await spec(
            intent('g-expenses', { span: 'year', year: 'previous' }, { compared: { year: 2023 } })
        );
        expect(element(fine, 'Report').props.notice).toBeUndefined();
        expect(element(fine, 'Answer').props.comparison).toBe(`vs. ${isolate('2023')}`);
    });

    it('writes the request a report answers with its period as asked, relative words relative', async () => {
        const texts: [ReportIntent, string][] = [
            [intent('g-expenses', 'this_year'), 'Expenses this year'],
            [intent('g-expenses', 'last_year'), 'Expenses last year'],
            [
                intent(
                    'g-expenses',
                    { span: 'year', year: 'previous' },
                    { compared: { year: 2023 } }
                ),
                'Expenses last year vs. 2023',
            ],
            [
                intent(
                    'g-expenses',
                    { span: 'quarter', year: 2024, quarter: 3 },
                    {
                        compared: { quarter: 1 },
                    }
                ),
                'Expenses Q3 2024 vs. Q1 2024',
            ],
            [
                intent('g-expenses', { quarter: 3 }, { compared: { quarter: 1 } }),
                'Expenses Q3 vs. Q1',
            ],
            [
                intent('g-expenses', { month: 1 }, { compared: { year: 2019 } }),
                'Expenses January vs. January 2019',
            ],
            [
                intent('g-expenses', { span: 'month', month: 1, year: 'previous' }),
                'Expenses January last year',
            ],
            [
                intent('g-expenses', 'this_quarter', { compareWith: 'year_earlier' }),
                'Expenses this quarter vs. the same period a year earlier',
            ],
            [intent('g-expenses', 'last_month'), 'Expenses last month'],
            [intent('g-expenses', '2026-09'), 'Expenses September 2026'],
            [intent('g-expenses', 'ytd'), 'Expenses year to date'],
            [intent('g-expenses', 'last_12_months'), 'Expenses last 12 months'],
            [intent('g-expenses', 'all'), 'Expenses all time'],
            [intent('g-assets', 'today'), 'Assets now'],
            [intent('g-assets', 'last_year'), 'Assets last year'],
            [intent('net-result', 'this_month'), 'Net income this month'],
        ];
        for (const [request, text] of texts) {
            const built = await spec(request);
            expect(reportText(built), JSON.stringify(request.period)).toBe(text);
        }
    });

    it('writes a quarter’s year once, in languages whose quarter names it with a word', async () => {
        addAllLocales();
        const quarter = await spec(intent('g-expenses', '2026-Q3'), 'ja');
        expect(element(quarter, 'Report').props.subtitle).toBe(
            t('period_quarter', 'ja', { quarter: isolate('3'), year: isolate('2026') })
        );
        const compared = await spec(
            intent(
                'g-expenses',
                { span: 'quarter', year: 2024, quarter: 3 },
                {
                    compared: { quarter: 1 },
                }
            ),
            'ja'
        );
        expect(reportText(compared)).toBe('Expenses 2024年第3四半期と2024年第1四半期の比較');
    });

    it('keeps relative periods relative in the request, in every language', async () => {
        addAllLocales();
        for (const lang of ['en', 'pt', 'ja', 'ar']) {
            for (const id of RELATIVE_PERIODS) {
                const built = await spec(intent('g-expenses', id), lang);
                // A written year would turn the request into a fixed one.
                expect(reportText(built), `${lang} ${id}`).not.toMatch(/\p{Nd}{4}/u);
                expect(reportText(built), `${lang} ${id}`).toMatch(/^Expenses /);
            }
        }
    });

    it('dates a balance now and at the end of a month, against the end of a month', async () => {
        const now = await spec(intent('g-assets', 'today', { chart: 'compare' }));
        expect(element(now, 'Report').props.subtitle).toBe(`As of ${isolate('Nov 5, 2026')}`);
        expect(element(now, 'Answer').props.comparison).toBe(`vs. ${isolate('Oct 31, 2026')}`);
        const ended = await spec(intent('g-assets', 'last_month', { chart: 'compare' }));
        expect(element(ended, 'Report').props.subtitle).toBe(`As of ${isolate('Oct 31, 2026')}`);
        expect(element(ended, 'Answer').props.comparison).toBe(`vs. ${isolate('Sep 30, 2026')}`);
        const chart = element(ended, 'Chart').props;
        expect('periods' in chart && chart.periods).toEqual({
            current: `As of ${isolate('Oct 31, 2026')}`,
            previous: `As of ${isolate('Sep 30, 2026')}`,
        });
    });

    it('labels alike whatever the date format Bkper writes the Book in', async () => {
        const requests = [
            intent('g-expenses', 'this_year'),
            intent('g-expenses', '2026-Q3'),
            intent('g-expenses', 'last_month'),
            intent('g-expenses', 'all'),
            intent('g-assets', 'today'),
        ];
        const texts = async (pattern: string, lang: string) => {
            const ledger = fixtureLedger();
            ledger.book.datePattern = pattern;
            const built = await Promise.all(
                requests.map(request => spec(request, lang, undefined, ledger))
            );
            return built.map(one => [
                element(one, 'Report').props.subtitle,
                element(one, 'Answer').props.comparison,
                element(one, 'Source').props.period,
            ]);
        };
        for (const lang of ['en', 'ar']) {
            const dayFirst = await texts('dd/MM/yyyy', lang);
            expect(dayFirst[0][0]).toBe(
                lang === 'en'
                    ? `Jan${TO}Nov 2026`
                    : new Intl.DateTimeFormat('ar', {
                          month: 'short',
                          year: 'numeric',
                          timeZone: 'UTC',
                      }).formatRange(Date.UTC(2026, 0, 1), Date.UTC(2026, 10, 30))
            );
            expect(await texts('MM/dd/yyyy', lang)).toEqual(dayFirst);
            expect(await texts('yyyy/MM/dd', lang)).toEqual(dayFirst);
        }
    });

    it('labels the forms of a period in right-to-left languages', async () => {
        addAllLocales();
        const date = (iso: string) => new Date(`${iso}T00:00:00Z`);
        for (const lang of ['ar', 'he']) {
            const format = (options: Intl.DateTimeFormatOptions) =>
                new Intl.DateTimeFormat(lang, { ...options, timeZone: 'UTC' });
            const monthRange = format({ month: 'short', year: 'numeric' });
            const month = format({ month: 'long', year: 'numeric' });
            const year = format({ year: 'numeric' });
            const day = format({ dateStyle: 'medium' });
            const forms: [ReportIntent, string, string][] = [
                [
                    intent('g-expenses', '2025'),
                    year.format(date('2025-01-01')),
                    year.format(date('2024-01-01')),
                ],
                [
                    intent('g-expenses', 'last_month'),
                    month.format(date('2026-10-01')),
                    month.format(date('2026-09-01')),
                ],
                [
                    intent('g-expenses', 'this_year'),
                    monthRange.formatRange(date('2026-01-01'), date('2026-11-30')),
                    monthRange.formatRange(date('2025-01-01'), date('2025-11-30')),
                ],
                [
                    intent('g-assets', 'today'),
                    t('position_as_of', lang, { date: isolate(day.format(date('2026-11-05'))) }),
                    day.format(date('2026-10-31')),
                ],
            ];
            for (const [request, current, previous] of forms) {
                const built = await spec(request, lang);
                const what = `${lang} ${request.period}`;
                expect(element(built, 'Report').props.subtitle, what).toBe(current);
                expect(element(built, 'Answer').props.comparison, what).toBe(
                    t('answer_compared_with', lang, { period: isolate(previous) })
                );
                expect(element(built, 'Report').props.dir).toBe('rtl');
            }
            expect(
                element(await spec(intent('g-expenses', 'all'), lang), 'Report').props.subtitle
            ).toBe(t('period_all', lang));
        }
    });

    it('has no comparison for all time, and reads it from the first month of data', async () => {
        const built = await spec(intent('g-expenses', 'all'));
        expect(element(built, 'Report').props.subtitle).toBe('All time');
        expect(element(built, 'Answer').props.comparison).toBeUndefined();
        expect(element(built, 'Answer').props.previous).toBeUndefined();
        expect(element(built, 'Source').props.period).toBe(`Mar 1, 2024${TO}Nov 30, 2026`);
    });

    it('labels a net result Report calculates, and says so in the Source', async () => {
        const built = await spec(
            intent('net-result', '2026-10', { monthly: true }),
            'en',
            undefined,
            simpleRootsLedger()
        );
        expect(element(built, 'Report').props.title).toBe('Net result');
        const answer = element(built, 'Answer').props;
        expect(answer.label).toBe('Net result');
        expect(answer.parts).toBeUndefined();
        // Its roots are the rows, as Bkper names them.
        const table = element(built, 'BreakdownTable').props;
        expect(table.rows.map(row => [row.label, row.kind])).toEqual([
            ['Revenue', 'group'],
            ['Expenses', 'group'],
        ]);
        const chart = element(built, 'Chart').props;
        expect(chart).toMatchObject({ kind: 'bar', label: `${isolate('Net result')} by month` });
        expect(
            'series' in chart && chart.series.map(series => [series.label, series.line ?? false])
        ).toEqual([
            ['Revenue', false],
            ['Expenses', false],
            ['Net result', true],
        ]);
        expect(element(built, 'Source').props.calculated).toEqual({
            label: 'Calculated by Report',
            note: t('source_calculated_note', 'en'),
        });
    });

    it('totals the table of a net result Report calculates, each root as Bkper returns it', async () => {
        const data = await report(
            intent('net-result', 'this_month', { monthly: true }),
            undefined,
            simpleRootsLedger()
        );
        const built = buildReportSpec(data, 'en');
        const table = element(built, 'BreakdownTable').props;
        const chart = element(built, 'Chart').props;
        const root = (id: string) => {
            const row = table.rows.find(candidate => candidate.id === id);
            const series = 'series' in chart && chart.series.find(entry => entry.id === id);
            return [row?.amount, row?.change, series && series.values];
        };
        expect(root('g-expenses')).toEqual(['1050.25', '-0.1252', ['1050.25']]);
        expect(root('g-revenue')).toEqual(['5000', '0', ['5000']]);
        expect(table.total).toEqual({
            label: 'Net result',
            color: 'grey',
            amount: '3949.75',
            previous: '3799.5',
            change: '0.0395',
            months: ['3949.75'],
        });
    });

    it('titles the net result of a combining group by its name, with nothing calculated', async () => {
        const built = await spec(intent('net-result', 'this_month'));
        expect(element(built, 'Report').props.title).toBe('Net income');
        expect(element(built, 'BreakdownTable').props.total).toBeUndefined();
        expect(element(built, 'Source').props.calculated).toBeUndefined();
        const group = await spec(intent('g-expenses', 'last_month'));
        expect(element(group, 'BreakdownTable').props.total).toBeUndefined();
        expect(element(group, 'Source').props.calculated).toBeUndefined();
    });

    it('titles a target by its name and breaks it down, but an account, which has no parts', async () => {
        const banks = await spec(intent('g-assets', 'today', { target: 'g-banks' }));
        expect(element(banks, 'Report').props.title).toBe('Banks');
        expect(labels(element(banks, 'BreakdownTable').props.rows)).toEqual(['Bank A']);

        for (const request of [
            intent('g-expenses', '2026', { monthly: true, target: 'a-rent' }),
            intent('a-owner', 'today'),
        ]) {
            const account = await spec(request);
            const types = Object.values(account.elements).map(candidate => candidate.type);
            expect(types).not.toContain('BreakdownTable');
            expect(types).toContain('Answer');
            expect(validateReportSpec(account).valid).toBe(true);
        }
        expect(element(await spec(intent('a-owner', 'today')), 'Report').props.title).toBe('Owner');
    });

    it('shows targets side by side, each with its own Answer, and no total', async () => {
        const request = intent('g-expenses', 'last_month', {
            target: 'a-food',
            alongside: [{ root: 'g-revenue' }],
        });
        const built = await spec(request);
        expect(validateReportSpec(built).valid).toBe(true);
        const report = element(built, 'Report');
        expect(report.props.title).toBe(`${isolate('Food')} and ${isolate('Revenue')}`);
        const answers = report.children
            .map(id => built.elements[id])
            .filter(
                (candidate): candidate is Extract<ReportElement, { type: 'Answer' }> =>
                    candidate?.type === 'Answer'
            );
        expect(answers.map(answer => answer.props)).toEqual([
            {
                label: 'Food',
                color: 'red',
                amount: '200.5',
                previous: '0',
                comparison: `vs. ${isolate('September 2026')}`,
            },
            {
                label: 'Revenue',
                color: 'green',
                amount: '5000',
                previous: '0',
                comparison: `vs. ${isolate('September 2026')}`,
            },
        ]);
        // The answers come first, in the order asked for.
        expect(report.children.slice(0, 2)).toEqual(['answer-1', 'answer-2']);

        const table = element(built, 'BreakdownTable').props;
        expect(table.total).toBeUndefined();
        expect(table.label).toBe(`${isolate(report.props.title)} side by side`);
        expect(table.rows.map(row => [row.label, row.amount, row.share])).toEqual([
            ['Food', '200.5', undefined],
            ['Revenue', '5000', undefined],
        ]);
        const chart = element(built, 'Chart').props;
        expect(chart).toMatchObject({
            kind: 'ranked-bar',
            label: `${isolate(report.props.title)} side by side`,
        });
        expect(element(built, 'Source').props.query).toBe(
            "(account:'Food' OR group:'Revenue') on:$m-1 by:m"
        );
        expect(element(built, 'Source').props.calculated).toBeUndefined();
    });

    it('says why a pie of targets side by side does not fit, in the report’s language', async () => {
        const request = intent('g-expenses', '2026', {
            target: 'a-food',
            alongside: [{ root: 'g-expenses', target: 'a-rent' }],
            chart: 'pie',
        });
        const unfit = element(await spec(request), 'Visualizations').props.unfit;
        expect(unfit).toEqual({
            kind: 'pie',
            name: 'Pie',
            reason: t('chart_unfit_side_by_side', 'en'),
        });
        addAllLocales();
        const pt = element(await spec(request, 'pt'), 'Visualizations').props.unfit;
        expect(pt?.reason).toBe(t('chart_unfit_side_by_side', 'pt'));
        expect(element(await spec(request, 'pt'), 'Report').props.title).toBe(
            `${isolate('Food')} e ${isolate('Rent')}`
        );
    });

    it('keeps Bkper names verbatim and nests rows like the report', async () => {
        const built = await spec(intent('g-assets', 'today'));
        expect(labels(element(built, 'BreakdownTable').props.rows)).toEqual([
            'Banks',
            '  Bank A',
            'Cash',
        ]);
    });

    it('shows the breakdown chart items in breakdown order', async () => {
        const built = await spec(intent('g-assets', 'today'));
        expect(element(built, 'Chart').props).toEqual({
            kind: 'donut',
            label: `Breakdown of ${isolate('Assets')}`,
            items: [
                { rowId: 'g-banks', label: 'Banks', color: 'blue', value: '7749.25' },
                { rowId: 'a-cash', label: 'Cash', color: 'blue', value: '100' },
            ],
        });
    });

    it('shows the months of the chart and of every row', async () => {
        const built = await spec(intent('g-assets', '2026-Q4', { monthly: true }));
        expect(element(built, 'Chart').props).toMatchObject({
            kind: 'line',
            label: `${isolate('Assets')} by month`,
            months: ['2026-10', '2026-11'],
            series: [{ id: 'g-assets', label: 'Assets', values: ['3899.5', '7849.25'] }],
        });
        expect(element(built, 'BreakdownTable').props.months).toEqual(['2026-10', '2026-11']);
    });

    it('leaves the chart out when the report has none, and offers the charts that fit', async () => {
        const built = await spec(intent('g-expenses', 'last_month', { view: 'total' }));
        expect(Object.values(built.elements).map(part => part.type)).toEqual([
            'Report',
            'Answer',
            'Visualizations',
            'BreakdownTable',
            'Source',
        ]);
        expect(built.elements[built.root].type).toBe('Report');
        expect(element(built, 'Visualizations').props.main).toBe('table');
    });

    it('leaves the charts out when only the table fits', async () => {
        const built = await spec(intent('g-card', 'last_year', { monthly: true }));
        expect(Object.values(built.elements).map(part => part.type)).toEqual([
            'Report',
            'Answer',
            'BreakdownTable',
            'Source',
        ]);
    });

    it('binds expanding rows and opening the query in Bkper', async () => {
        const data = await report(intent('g-expenses', 'last_month'));
        const built = buildReportSpec(data, 'en');
        expect(element(built, 'BreakdownTable').on).toEqual({ expand: { action: 'expandRow' } });
        expect(element(built, 'Source').on).toEqual({
            open: { action: 'openInBkper', params: { url: data.url } },
        });
        expect(element(built, 'Source').props.url).toBe(data.url);
    });

    it('writes in the language asked for, in English where it has no translation', async () => {
        addLocale('pt', { report_net_result: 'Resultado', source_calculated: 'Calculado' });
        const built = await spec(
            intent('net-result', '2026-10'),
            'pt-BR',
            undefined,
            simpleRootsLedger()
        );
        expect(element(built, 'Report').props).toMatchObject({
            title: 'Resultado',
            subtitle: 'outubro de 2026',
            locale: 'pt-BR',
        });
        expect(element(built, 'Source').props.calculated).toEqual({
            label: 'Calculado',
            note: t('source_calculated_note', 'en'),
        });
        expect(element(built, 'Answer').props.comparison).toBe(
            `vs. ${isolate('setembro de 2026')}`
        );
    });

    it('lays out right-to-left languages right to left', async () => {
        const built = await spec(intent('g-expenses', 'last_month'), 'ar');
        expect(element(built, 'Report').props.dir).toBe('rtl');
    });

    it('isolates the values it writes into right-to-left texts, in the report locale', async () => {
        addAllLocales();
        const day = (lang: string) =>
            new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' });
        const months = (lang: string) =>
            new Intl.DateTimeFormat(lang, { month: 'short', year: 'numeric', timeZone: 'UTC' });
        const date = (iso: string) => new Date(`${iso}T00:00:00Z`);
        for (const lang of ['ar', 'he']) {
            const current = await spec(intent('g-expenses', 'this_year'), lang);
            const range = months(lang).formatRange(date('2025-01-01'), date('2025-11-30'));
            const comparison = element(current, 'Answer').props.comparison;
            expect(comparison).toBe(t('answer_compared_with', lang, { period: isolate(range) }));
            expect(comparison).not.toMatch(/[A-Za-z]/);
            expect(element(current, 'Source').props.footer).toBe(
                t('source_footer', lang, { book: isolate('Test Ledger') })
            );
            expect(element(current, 'Report').props.dir).toBe('rtl');
            const position = await spec(intent('g-assets', 'today'), lang);
            expect(element(position, 'Report').props.subtitle).toBe(
                t('position_as_of', lang, { date: isolate(day(lang).format(date('2026-11-05'))) })
            );
        }
        const quarter = await spec(intent('g-expenses', '2026-Q3'), 'ar-EG');
        expect(element(quarter, 'Report').props.subtitle).toBe(
            t('period_quarter', 'ar-EG', { quarter: isolate('٣'), year: isolate('٢٠٢٦') })
        );
    });

    it('draws a pie of the parts like a donut', async () => {
        const built = await spec(intent('g-expenses', 'last_month', { chart: 'pie' }));
        expect(element(built, 'Chart').props).toEqual({
            kind: 'pie',
            label: `Breakdown of ${isolate('Expenses')}`,
            items: [
                { rowId: 'a-rent', label: 'Rent', color: 'red', value: '1000' },
                { rowId: 'a-food', label: 'Food', color: 'red', value: '200.5' },
            ],
        });
    });

    it('stacks a series for each part, by its name', async () => {
        const built = await spec(intent('g-expenses', 'this_year', { chart: 'stacked' }));
        const chart = element(built, 'Chart').props;
        expect(chart).toMatchObject({
            kind: 'stacked',
            label: `${isolate('Expenses')} by month`,
            months: element(built, 'BreakdownTable').props.months,
        });
        expect('series' in chart && chart.series.map(series => [series.id, series.label])).toEqual([
            ['a-rent', 'Rent'],
            ['a-food', 'Food'],
        ]);
    });

    it('draws areas by month', async () => {
        const built = await spec(intent('g-assets', '2026-Q4', { chart: 'area' }));
        expect(element(built, 'Chart').props).toMatchObject({
            kind: 'area',
            months: ['2026-10', '2026-11'],
            series: [{ id: 'g-assets', label: 'Assets', values: ['3899.5', '7849.25'] }],
        });
    });

    it('compares each part with the previous period, naming both periods', async () => {
        const built = await spec(intent('g-expenses', 'this_month', { chart: 'compare' }));
        expect(element(built, 'Chart').props).toEqual({
            kind: 'compare',
            label: `Breakdown of ${isolate('Expenses')}`,
            // Both by their dates, in the same style.
            periods: { current: 'November 2026', previous: 'October 2026' },
            items: [
                { rowId: 'a-rent', label: 'Rent', color: 'red', value: '1000', previous: '1000' },
                { rowId: 'a-food', label: 'Food', color: 'red', value: '50.25', previous: '200.5' },
            ],
        });
        const position = await spec(intent('g-assets', 'today', { chart: 'compare' }));
        const chart = element(position, 'Chart').props;
        expect('periods' in chart && chart.periods).toEqual({
            current: `As of ${isolate('Nov 5, 2026')}`,
            previous: `As of ${isolate('Oct 31, 2026')}`,
        });
    });

    it('names both compared periods absolutely, in the same style, in any language', async () => {
        const whole = await spec(intent('g-expenses', 'last_month', { chart: 'compare' }));
        const chart = element(whole, 'Chart').props;
        expect('periods' in chart && chart.periods).toEqual({
            current: 'October 2026',
            previous: 'September 2026',
        });
        const month = (date: number) =>
            new Intl.DateTimeFormat('ar', {
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
            }).format(date);
        const arabic = await spec(intent('g-expenses', 'last_month', { chart: 'compare' }), 'ar');
        const rtl = element(arabic, 'Chart').props;
        expect('periods' in rtl && rtl.periods).toEqual({
            current: month(Date.UTC(2026, 9, 1)),
            previous: month(Date.UTC(2026, 8, 1)),
        });
        expect(month(Date.UTC(2026, 9, 1))).toMatch(/\p{Script=Arabic}/u);
    });

    it('draws no bridge, and says why', async () => {
        for (const request of [
            intent('net-result', 'this_month', { chart: 'waterfall' }),
            intent('g-assets', 'today', { chart: 'waterfall' }),
        ]) {
            const built = await spec(request);
            expect(element(built, 'Chart').props.kind).toBe('compare');
            expect(element(built, 'Visualizations').props.unfit).toEqual({
                kind: 'waterfall',
                name: 'Bridge',
                reason: t('chart_unfit_no_bridge', 'en'),
            });
        }
    });

    it('offers every other chart that fits, with the data the preferred chart would have', async () => {
        const request = intent('g-expenses', '2026', { monthly: true });
        const built = await spec(request);
        const views = element(built, 'Visualizations');
        expect(views.on).toEqual({ select: { action: 'selectChart' } });
        expect(views.props.label).toBe('Charts');
        expect(views.props.main).toBe('bar');
        expect(views.props.views.map(view => [view.kind, view.name])).toEqual([
            ['bar', 'By month'],
            ['area', 'Area'],
            ['stacked', 'Stacked'],
            ['ranked-bar', 'Ranked'],
            ['donut', 'Donut'],
            ['pie', 'Pie'],
            ['compare', 'Compared'],
            ['table', 'Table'],
        ]);
        // The main chart is the Chart, and the table has no chart.
        expect(views.props.views.filter(view => !view.chart).map(view => view.kind)).toEqual([
            'bar',
            'table',
        ]);
        expect(views.props.unfit).toBeUndefined();
        for (const kind of ['area', 'stacked', 'pie', 'compare'] as const) {
            const preferred = await spec({ ...request, chart: kind });
            expect(views.props.views.find(view => view.kind === kind)?.chart, kind).toEqual(
                element(preferred, 'Chart').props
            );
        }
        const pie = element(await spec({ ...request, chart: 'pie' }), 'Visualizations').props;
        expect(pie.main).toBe('pie');
        expect(pie.views.find(view => view.kind === 'bar')?.chart).toEqual(
            element(built, 'Chart').props
        );
    });

    it('dims the preferred chart that does not fit, naming the part and its amount', async () => {
        // A refund of taxes in October: the account shows below zero, as in Bkper.
        const ledger = fixtureLedger();
        const food = ledger.book.accounts?.find(account => account.name === 'Food');
        if (food) {
            food.name = 'IMPOSTOS';
        }
        for (const transaction of ledger.transactions) {
            if (transaction.to === 'Food') {
                transaction.to = 'IMPOSTOS';
            }
        }
        ledger.transactions.push({
            date: '2026-10-20',
            from: 'IMPOSTOS',
            to: 'Bank A',
            amount: '387.24',
        });
        const snapshot = await ledgerSnapshot(ledger);
        const request = intent('g-expenses', 'last_month', { chart: 'pie' });
        const english = element(
            await spec(request, 'en', snapshot, ledger),
            'Visualizations'
        ).props;
        expect(english.unfit).toEqual({
            kind: 'pie',
            name: 'Pie',
            reason: t('chart_unfit_negative_part', 'en', {
                name: isolate('IMPOSTOS'),
                amount: isolate('-186.74'),
            }),
        });
        expect(english.main).toBe('ranked-bar');
        expect(english.views.map(view => view.kind)).not.toContain('pie');
        const portuguese = element(
            await spec(request, 'pt-BR', snapshot, ledger),
            'Visualizations'
        );
        expect(portuguese.props.unfit?.reason).toContain(isolate('-186,74'));
    });

    it('says why a preferred chart does not fit, in the words of that chart', async () => {
        const reason = async (request: ReportIntent) =>
            element(await spec(request), 'Visualizations').props.unfit?.reason;
        expect(await reason(intent('net-result', 'last_month', { chart: 'pie' }))).toBe(
            t('chart_unfit_pie_net_result', 'en')
        );
        expect(await reason(intent('net-result', '2026', { chart: 'stacked' }))).toBe(
            t('chart_unfit_stacked_net_result', 'en')
        );
        expect(await reason(intent('g-expenses', 'all', { chart: 'compare' }))).toBe(
            t('chart_unfit_no_previous', 'en')
        );
        expect(await reason(intent('g-expenses', 'last_month', { chart: 'waterfall' }))).toBe(
            t('chart_unfit_no_bridge', 'en')
        );
        const mixed = withAccounts(fixtureLedger(), ['50']);
        const snapshot = await ledgerSnapshot(mixed);
        snapshot.accounts['extra-0'].type = 'ASSET';
        const stacked = intent('g-expenses', '2026', { monthly: true, chart: 'stacked' });
        expect(
            element(await spec(stacked, 'en', snapshot, mixed), 'Visualizations').props.unfit
                ?.reason
        ).toBe(t('chart_unfit_stacked_mixed_parts', 'en'));
        const many = withAccounts(fixtureLedger(), ['5', '4', '3', '2', '1']);
        expect(
            element(await spec(stacked, 'en', undefined, many), 'Visualizations').props.unfit
                ?.reason
        ).toBe(t('chart_unfit_stacked_too_many_parts', 'en'));
    });

    it('says the parts Bkper returns are no whole of the total', async () => {
        const ledger = fixtureLedger();
        const snapshot = await ledgerSnapshot(ledger);
        const request = intent('g-expenses', 'all', { chart: 'pie' });
        const balances = planQueries(planReport(request, snapshot)).map(query => {
            const read = ledgerBalances(ledger, query);
            delete read.accounts.Food;
            read.groups.Expenses.accounts = ['Rent', 'Old Supplier'];
            return read;
        });
        const built = buildReportSpec(buildReport(request, snapshot, balances), 'en');
        expect(element(built, 'Visualizations').props.unfit?.reason).toBe(
            t('chart_unfit_not_a_whole', 'en')
        );
    });

    it('leaves the chart out of a table', async () => {
        const built = await spec(intent('g-expenses', '2026', { monthly: true, chart: 'table' }));
        expect(Object.values(built.elements).some(part => part.type === 'Chart')).toBe(false);
    });
});

/** Adds Expenses accounts, each moving its amount on 2026-10-01 from `Owner`. */
function withAccounts(ledger: FakeLedger, amounts: string[]): FakeLedger {
    amounts.forEach((amount, i) => {
        const name = `Extra ${i}`;
        ledger.addAccount({ id: `extra-${i}`, name, type: 'OUTGOING', groups: ['g-expenses'] });
        ledger.transactions.push({ date: '2026-10-01', from: 'Owner', to: name, amount });
    });
    return ledger;
}
