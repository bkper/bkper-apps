import { validateReportSpec, type ReportElement, type ReportSpec } from 'report-shared/catalog';
import { isolate } from 'report-shared/bidi';
import { addAllLocales } from 'report-shared/locales';
import { addLocale, t } from 'report-shared/strings';
import { describe, expect, it } from 'vitest';
import { buildReport, planQueries, planReport, type ReportData } from '../../src/services/report';
import type { ReportIntent } from '../../src/services/report-intent';
import { buildReportSpec } from '../../src/services/report-spec';
import type { Snapshot } from '../../src/services/snapshot';
import type { FakeLedger } from '../fixtures/ledger';
import {
    fixtureLedger,
    fixtureSnapshot,
    ledgerBalances,
    ledgerSnapshot,
} from '../fixtures/snapshot-book';

function intent(root: string, period: string, extra: Partial<ReportIntent> = {}): ReportIntent {
    return { root, period, monthly: false, ...extra };
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
        for (const lang of ['en', 'pt-BR', 'ja', 'ar', 'sw', 'mni-Mtei']) {
            for (const request of intents) {
                const built = await spec(request, lang);
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
            subtitle: 'Last month',
            dir: 'ltr',
        });
        expect(element(built, 'Answer').props).toMatchObject({
            label: 'Expenses',
            comparison: `vs. ${isolate('September 2026')}`,
        });
        expect(element(built, 'Source').props).toMatchObject({
            footer: `Computed from the balances of ${isolate('Test Ledger')}`,
            period: `Oct 1${TO}31, 2026`,
            query: "group:'Expenses' after:2026-10-01 before:2026-11-01",
        });
    });

    it('names calendar periods and the span a current period compares with', async () => {
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
        expect(element(current, 'Report').props.subtitle).toBe('This year');
        expect(element(current, 'Answer').props.comparison).toBe(
            `vs. ${isolate(`Jan 1${TO}Nov 5, 2025`)}`
        );
    });

    it('dates a position and compares it with an earlier date', async () => {
        const built = await spec(intent('g-assets', 'today'));
        expect(element(built, 'Report').props.subtitle).toBe(`As of ${isolate('Nov 5, 2026')}`);
        expect(element(built, 'Answer').props.comparison).toBe(`vs. ${isolate('Oct 31, 2026')}`);
        expect(element(built, 'Source').props.period).toBe(`As of ${isolate('Nov 5, 2026')}`);
    });

    it('has no comparison for all time, and reads it from the first month of data', async () => {
        const built = await spec(intent('g-expenses', 'all'));
        expect(element(built, 'Report').props.subtitle).toBe('All time');
        expect(element(built, 'Answer').props.comparison).toBeUndefined();
        expect(element(built, 'Answer').props.previous).toBeUndefined();
        expect(element(built, 'Source').props.period).toBe(`Mar 1, 2024${TO}Nov 5, 2026`);
    });

    it('labels the net result and its Incoming and Outgoing sides', async () => {
        const built = await spec(intent('net-result', '2026-10', { monthly: true }));
        expect(element(built, 'Report').props.title).toBe('Net result');
        const answer = element(built, 'Answer').props;
        expect(answer.label).toBe('Net result');
        expect(answer.parts?.map(part => [part.id, part.label, part.color])).toEqual([
            ['incoming', 'Incoming', 'green'],
            ['outgoing', 'Outgoing', 'red'],
        ]);
        const table = element(built, 'BreakdownTable').props;
        expect(table.rows.map(row => row.label)).toEqual(['Incoming', 'Outgoing']);
        const chart = element(built, 'Chart').props;
        expect(chart).toMatchObject({ kind: 'bar', label: `${isolate('Net result')} by month` });
        expect(
            'series' in chart && chart.series.map(series => [series.label, series.line ?? false])
        ).toEqual([
            ['Incoming', false],
            ['Outgoing', false],
            ['Net result', true],
        ]);
    });

    it('shows Outgoing positive everywhere, under the total of the net result', async () => {
        const data = await report(intent('net-result', 'this_month', { monthly: true }));
        const built = buildReportSpec(data, 'en');
        const answer = element(built, 'Answer').props;
        const table = element(built, 'BreakdownTable').props;
        const chart = element(built, 'Chart').props;
        const side = (id: string) => {
            const part = answer.parts?.find(candidate => candidate.id === id);
            const row = table.rows.find(candidate => candidate.id === id);
            const series = 'series' in chart && chart.series.find(entry => entry.id === id);
            return [part?.amount, part?.change, row?.amount, row?.change, series && series.values];
        };
        expect(side('outgoing')).toEqual(['1050.25', '0.0503', '1050.25', '0.0503', ['1050.25']]);
        expect(side('incoming')).toEqual(['5000', '0', '5000', '0', ['5000']]);
        expect(table.total).toEqual({
            label: 'Net result',
            color: 'grey',
            amount: '3949.75',
            previous: '4000',
            change: '-0.0126',
            months: ['3949.75'],
        });
    });

    it('totals only the table of a net result', async () => {
        const built = await spec(intent('g-expenses', 'last_month'));
        expect(element(built, 'BreakdownTable').props.total).toBeUndefined();
    });

    it('labels the remainder Bkper left out of a group', async () => {
        const snapshot = await fixtureSnapshot();
        snapshot.groups['g-expenses'].accounts = ['a-rent', 'a-old'];
        const built = await spec(intent('g-expenses', 'this_month'), 'en', snapshot);
        const table = element(built, 'BreakdownTable').props;
        expect(labels(table.rows)).toEqual(['Rent', 'Other']);
        expect(table.rows[1]).toMatchObject({ id: 'g-expenses:other', kind: 'other' });
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
        addLocale('pt', { report_net_result: 'Resultado', row_incoming: 'Entradas' });
        const built = await spec(intent('net-result', '2026-10'), 'pt-BR');
        expect(element(built, 'Report').props).toMatchObject({
            title: 'Resultado',
            subtitle: 'outubro de 2026',
            locale: 'pt-BR',
        });
        expect(element(built, 'Answer').props.parts?.map(part => part.label)).toEqual([
            'Entradas',
            'Outgoing',
        ]);
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
        const date = (iso: string) => new Date(`${iso}T00:00:00Z`);
        for (const lang of ['ar', 'he']) {
            const current = await spec(intent('g-expenses', 'this_year'), lang);
            const range = day(lang).formatRange(date('2025-01-01'), date('2025-11-05'));
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

    it('stacks a series for each part, and names the rest Other', async () => {
        const snapshot = await fixtureSnapshot();
        snapshot.groups['g-expenses'].accounts = ['a-rent', 'a-old'];
        const built = await spec(
            intent('g-expenses', 'this_year', { chart: 'stacked' }),
            'en',
            snapshot
        );
        const chart = element(built, 'Chart').props;
        expect(chart).toMatchObject({
            kind: 'stacked',
            label: `${isolate('Expenses')} by month`,
            months: element(built, 'BreakdownTable').props.months,
        });
        expect('series' in chart && chart.series.map(series => [series.id, series.label])).toEqual([
            ['a-rent', 'Rent'],
            ['other', 'Other'],
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
            periods: { current: `Nov 1${TO}5, 2026`, previous: `Oct 1${TO}5, 2026` },
            items: [
                { rowId: 'a-rent', label: 'Rent', color: 'red', value: '1000', previous: '1000' },
                { rowId: 'a-food', label: 'Food', color: 'red', value: '50.25', previous: '0' },
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

    it('bridges Incoming to the net result', async () => {
        const built = await spec(intent('net-result', 'this_month', { chart: 'waterfall' }));
        expect(element(built, 'Chart').props).toEqual({
            kind: 'waterfall',
            label: `Breakdown of ${isolate('Net result')}`,
            start: { label: 'Incoming', color: 'green', value: '5000' },
            steps: [
                { rowId: 'a-rent', label: 'Rent', color: 'red', value: '-1000' },
                { rowId: 'a-food', label: 'Food', color: 'red', value: '-50.25' },
            ],
            end: { label: 'Net result', color: 'grey', value: '3949.75' },
        });
    });

    it('bridges a position from one date to the other', async () => {
        const built = await spec(intent('g-assets', 'today', { chart: 'waterfall' }));
        expect(element(built, 'Chart').props).toEqual({
            kind: 'waterfall',
            label: `Breakdown of ${isolate('Assets')}`,
            start: { label: `As of ${isolate('Oct 31, 2026')}`, color: 'blue', value: '3899.5' },
            steps: [{ rowId: 'g-banks', label: 'Banks', color: 'blue', value: '3949.75' }],
            end: { label: `As of ${isolate('Nov 5, 2026')}`, color: 'blue', value: '7849.25' },
        });
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
            t('chart_unfit_not_a_bridge', 'en')
        );
    });

    it('leaves the chart out of a table', async () => {
        const built = await spec(intent('g-expenses', '2026', { monthly: true, chart: 'table' }));
        expect(Object.values(built.elements).some(part => part.type === 'Chart')).toBe(false);
    });
});
