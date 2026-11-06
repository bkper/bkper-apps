import { validateReportSpec, type ReportElement, type ReportSpec } from 'report-shared/catalog';
import { addLocale } from 'report-shared/strings';
import { describe, expect, it } from 'vitest';
import { buildReport, type ReportData } from '../../src/services/report';
import type { ReportIntent } from '../../src/services/report-intent';
import { buildReportSpec } from '../../src/services/report-spec';
import type { Snapshot } from '../../src/services/snapshot';
import { fixtureSnapshot } from '../fixtures/snapshot-book';

function intent(root: string, period: string, extra: Partial<ReportIntent> = {}): ReportIntent {
    return { root, period, monthly: false, ...extra };
}

async function report(request: ReportIntent, snapshot?: Snapshot): Promise<ReportData> {
    const step = buildReport(request, snapshot ?? (await fixtureSnapshot()));
    if (!('report' in step)) {
        throw new Error(`Needs a live query: ${step.liveQuery.query}`);
    }
    return step.report;
}

async function spec(request: ReportIntent, lang = 'en', snapshot?: Snapshot) {
    return buildReportSpec(await report(request, snapshot), lang);
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
            comparison: 'vs. September 2026',
        });
        expect(element(built, 'Source').props).toMatchObject({
            footer: 'Computed from the balances of Test Ledger',
            period: `Oct 1${TO}31, 2026`,
            query: "group:'Expenses' after:2026-10-01 before:2026-11-01",
        });
    });

    it('names calendar periods and the span a current period compares with', async () => {
        const quarter = await spec(intent('g-expenses', '2026-Q3'));
        expect(element(quarter, 'Report').props.subtitle).toBe('Q3 2026');
        expect(element(quarter, 'Answer').props.comparison).toBe('vs. Q2 2026');
        const month = await spec(intent('g-expenses', '2026-09'));
        expect(element(month, 'Report').props.subtitle).toBe('September 2026');
        const year = await spec(intent('g-expenses', '2025'));
        expect(element(year, 'Report').props.subtitle).toBe('2025');
        expect(element(year, 'Answer').props.comparison).toBe('vs. 2024');
        const current = await spec(intent('g-expenses', 'this_year'));
        expect(element(current, 'Report').props.subtitle).toBe('This year');
        expect(element(current, 'Answer').props.comparison).toBe(`vs. Jan 1${TO}Nov 5, 2025`);
    });

    it('dates a position and compares it with an earlier date', async () => {
        const built = await spec(intent('g-assets', 'today'));
        expect(element(built, 'Report').props.subtitle).toBe('As of Nov 5, 2026');
        expect(element(built, 'Answer').props.comparison).toBe('vs. Oct 31, 2026');
        expect(element(built, 'Source').props.period).toBe('As of Nov 5, 2026');
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
        expect(chart).toMatchObject({ kind: 'bar', label: 'Net result by month' });
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
            label: 'Breakdown of Assets',
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
            label: 'Assets by month',
            months: ['2026-10', '2026-11'],
            series: [{ id: 'g-assets', label: 'Assets', values: ['3899.5', '7849.25'] }],
        });
        expect(element(built, 'BreakdownTable').props.months).toEqual(['2026-10', '2026-11']);
    });

    it('leaves the chart out when the report has none', async () => {
        const built = await spec(intent('g-expenses', 'last_month', { view: 'total' }));
        expect(Object.values(built.elements).map(part => part.type)).toEqual([
            'Report',
            'Answer',
            'BreakdownTable',
            'Source',
        ]);
        expect(built.elements[built.root].type).toBe('Report');
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
        expect(element(built, 'Answer').props.comparison).toBe('vs. setembro de 2026');
    });

    it('lays out right-to-left languages right to left', async () => {
        const built = await spec(intent('g-expenses', 'last_month'), 'ar');
        expect(element(built, 'Report').props.dir).toBe('rtl');
    });
});
