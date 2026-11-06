/**
 * Evaluates intent resolution against the real decision model, on the two test Books.
 *
 *     BKPER_AI_TOKEN=<token> npx tsx scripts/eval-intent.ts [--only=<case number>,...]
 *
 * Each case is a request, in one of many languages, with the intent it should get. The script
 * loads both snapshots (read-only, with your `bkper auth token`), asks the model each request
 * in turn as the app does, and reports the accuracy of each part of the intent (the root, the
 * period, the months, the view and the chart preference, which code decides from the model's
 * judgments), of the language, of the whole intent (default period and chart included), and the
 * p50/p95 latency of the model calls. A case that names no chart expects `auto`, so every
 * report checks the chart. Each miss prints its trace: every judgment with its score, and the
 * rule that chose the chart.
 *
 * The model calls use `BKPER_AI_TOKEN` when set, else your `bkper auth token`, and are labelled
 * `bkper-ai-source: report-eval-intent`. Bkper AI caches identical requests for 15 minutes, so
 * a repeated run measures the cache: change nothing and rerun only to check accuracy.
 * Tune the questions, never the expected answers.
 */
import { execFileSync } from 'node:child_process';
import { Bkper } from 'bkper-js';
import { createDecisionClient, decide } from '../server/src/services/decision-client.ts';
import {
    THRESHOLDS,
    UNSPECIFIED,
    buildIntentRequest,
} from '../server/src/services/intent-questions.ts';
import { extractHashtags, readIntent } from '../server/src/services/intent-resolver.ts';
import { NET_RESULT_ROOT, type ChartPreference } from '../server/src/services/report-intent.ts';
import type { Snapshot } from '../server/src/services/snapshot.ts';
import { loadSnapshot, type SnapshotStore } from '../server/src/services/snapshot-loader.ts';
import { ServerTiming } from '../server/src/services/timing.ts';

const BOOKS = {
    nimbus: 'agtzfmJrcGVyLWhyZHINCxIGTGVkZ2VyGNEPDA',
    personal: 'agtzfmJrcGVyLWhyZHITCxIGTGVkZ2VyGICAgIOLzLQKDA',
} as const;

type BookKey = keyof typeof BOOKS;
type Accepted = string | string[];

/**
 * A request and what it should resolve to. Roots are group names, `net-result` or `none`;
 * `period` is the model's expected choice (`unspecified` when the request names none), and
 * `intentPeriod` the intent's period when it differs (the default period). `monthly`, `view`
 * and `chart` are the intent's (`view` is `unspecified` when left out, `chart` is `auto`). Lists
 * accept any of their answers: equally right readings, such as an account found in two roots.
 */
interface Case {
    book: BookKey;
    prompt: string;
    root: Accepted;
    language: string;
    period?: Accepted;
    intentPeriod?: string;
    monthly?: boolean;
    view?: Accepted;
    chart?: ChartPreference;
}

const NONE = 'none';

const CASES: Case[] = [
    // Nimbus Financeiro: Portuguese groups, data from 2010-10 to 2018-09.
    {
        book: 'nimbus',
        prompt: 'despesas de 2015',
        root: 'Despesas',
        period: '2015',
        language: 'pt',
    },
    {
        book: 'nimbus',
        prompt: 'quanto pagamos de impostos em 2012?',
        root: 'Impostos',
        period: '2012',
        view: ['total', UNSPECIFIED],
        language: 'pt',
    },
    {
        book: 'nimbus',
        prompt: 'receitas por mês em 2011',
        root: 'Receitas',
        period: '2011',
        monthly: true,
        view: 'trend',
        language: 'pt',
    },
    {
        book: 'nimbus',
        prompt: 'evolução das despesas',
        root: 'Despesas',
        period: UNSPECIFIED,
        intentPeriod: '2018',
        monthly: true,
        view: 'trend',
        language: 'pt',
    },
    {
        book: 'nimbus',
        prompt: 'lucro de 2013',
        root: NET_RESULT_ROOT,
        period: '2013',
        language: 'pt',
    },
    {
        book: 'nimbus',
        prompt: 'saldo do HSBC',
        root: 'Capital',
        period: UNSPECIFIED,
        intentPeriod: 'today',
        view: ['total', UNSPECIFIED],
        language: 'pt',
    },
    {
        book: 'nimbus',
        prompt: 'gastos en comidas en 2014',
        root: 'Despesas',
        period: '2014',
        language: 'es',
    },
    {
        book: 'nimbus',
        prompt: 'how much did we spend on office supplies in 2016?',
        root: 'Despesas',
        period: '2016',
        view: ['total', UNSPECIFIED],
        language: 'en',
    },
    {
        book: 'nimbus',
        prompt: 'bank fees in the first quarter of 2012',
        root: ['Tarifas', 'Despesas'],
        period: '2012-Q1',
        language: 'en',
    },
    {
        book: 'nimbus',
        prompt: 'salaires payés en mars 2013',
        root: ['RH', 'Despesas'],
        period: '2013-03',
        language: 'fr',
    },
    {
        book: 'nimbus',
        prompt: 'Umsatz im Jahr 2012 nach Kunden',
        root: 'Receitas',
        period: '2012',
        view: 'breakdown',
        language: 'de',
    },
    { book: 'nimbus', prompt: '2014年の税金', root: 'Impostos', period: '2014', language: 'ja' },
    {
        book: 'nimbus',
        prompt: 'debiti alla fine del 2015',
        root: 'Dívidas',
        period: ['2015', '2015-Q4', '2015-12'],
        language: 'it',
    },
    {
        book: 'nimbus',
        prompt: 'ingresos vs gastos en 2016',
        root: NET_RESULT_ROOT,
        period: '2016',
        language: 'es',
    },
    { book: 'nimbus', prompt: '2015年的收入', root: 'Receitas', period: '2015', language: 'zh-CN' },
    {
        book: 'nimbus',
        prompt: 'marketing costs 2014',
        root: ['Sales & Marketing', 'Despesas'],
        period: '2014',
        language: 'en',
    },
    {
        book: 'nimbus',
        prompt: '2013년 투자자',
        root: 'Investidores',
        period: '2013',
        language: 'ko',
    },
    {
        book: 'nimbus',
        prompt: 'expenses by category in Q3 2016',
        root: 'Despesas',
        period: '2016-Q3',
        view: 'breakdown',
        language: 'en',
    },
    { book: 'nimbus', prompt: "what's the weather tomorrow", root: NONE, language: 'en' },
    { book: 'nimbus', prompt: 'oi, tudo bem com você?', root: NONE, language: 'pt' },

    // Personal finances: English groups, data from 2019-04 to 2019-07.
    {
        book: 'personal',
        prompt: 'expenses in May 2019',
        root: 'Expenses',
        period: '2019-05',
        language: 'en',
    },
    {
        book: 'personal',
        prompt: 'how much did I spend on food in June 2019?',
        root: ['Expenses', 'Net income'],
        period: '2019-06',
        view: ['total', UNSPECIFIED],
        language: 'en',
    },
    {
        book: 'personal',
        prompt: 'minhas despesas mês a mês em 2019',
        root: 'Expenses',
        period: '2019',
        monthly: true,
        view: 'trend',
        language: 'pt',
    },
    {
        book: 'personal',
        prompt: '¿cuánto gané en 2019?',
        root: ['Revenue', 'Net income', NET_RESULT_ROOT],
        period: '2019',
        view: ['total', UNSPECIFIED],
        language: 'es',
    },
    {
        book: 'personal',
        prompt: 'Kontostand meiner Bankkonten',
        root: 'Assets',
        period: UNSPECIFIED,
        intentPeriod: 'today',
        view: ['total', UNSPECIFIED],
        language: 'de',
    },
    {
        book: 'personal',
        prompt: 'net income 2019',
        root: ['Net income', NET_RESULT_ROOT],
        period: '2019',
        language: 'en',
    },
    {
        book: 'personal',
        prompt: 'dépenses de transport en juillet 2019',
        root: ['Expenses', 'Net income'],
        period: '2019-07',
        language: 'fr',
    },
    {
        book: 'personal',
        prompt: 'credit card debt',
        root: 'Debts',
        period: UNSPECIFIED,
        intentPeriod: 'today',
        language: 'en',
    },
    {
        book: 'personal',
        prompt: 'matumizi yangu ya mwaka 2019',
        root: 'Expenses',
        period: '2019',
        language: 'sw',
    },
    {
        book: 'personal',
        prompt: 'الإيرادات في عام 2019',
        root: 'Revenue',
        period: '2019',
        language: 'ar',
    },
    {
        book: 'personal',
        prompt: '2019 में मेरे खर्च',
        root: 'Expenses',
        period: '2019',
        language: 'hi',
    },
    {
        book: 'personal',
        prompt: 'show me #travel expenses in 2019',
        root: 'Expenses',
        period: '2019',
        language: 'en',
    },
    {
        book: 'personal',
        prompt: 'monthly spending',
        root: 'Expenses',
        period: UNSPECIFIED,
        intentPeriod: '2019',
        monthly: true,
        view: 'trend',
        language: 'en',
    },
    {
        book: 'personal',
        prompt: 'send an email to my accountant',
        root: NONE,
        language: 'en',
    },

    // Charts asked for, in many languages, and requests that only sound like one.
    {
        book: 'nimbus',
        prompt: 'expenses in 2015 as a pie',
        root: 'Despesas',
        period: '2015',
        view: ['breakdown', UNSPECIFIED],
        chart: 'pie',
        language: 'en',
    },
    {
        book: 'nimbus',
        prompt: 'bridge from revenue to profit in 2014',
        root: NET_RESULT_ROOT,
        period: '2014',
        view: ['breakdown', UNSPECIFIED],
        chart: 'waterfall',
        language: 'en',
    },
    {
        book: 'nimbus',
        prompt: 'expenses in 2016 versus last year by category',
        root: 'Despesas',
        period: '2016',
        view: ['breakdown', UNSPECIFIED],
        chart: 'compare',
        language: 'en',
    },
    {
        book: 'personal',
        prompt: 'expenses in 2019, just the numbers',
        root: 'Expenses',
        period: '2019',
        view: ['total', 'breakdown', UNSPECIFIED],
        chart: 'table',
        language: 'en',
    },
    {
        book: 'personal',
        prompt: 'my expenses in 2019 stacked by month',
        root: 'Expenses',
        period: '2019',
        monthly: true,
        view: ['trend', UNSPECIFIED],
        chart: 'stacked',
        language: 'en',
    },
    {
        book: 'nimbus',
        prompt: 'despesas de 2013 num gráfico de pizza',
        root: 'Despesas',
        period: '2013',
        view: ['breakdown', UNSPECIFIED],
        chart: 'pie',
        language: 'pt',
    },
    {
        book: 'nimbus',
        prompt: 'cascata da receita até o lucro de 2015',
        root: NET_RESULT_ROOT,
        period: '2015',
        view: ['breakdown', UNSPECIFIED],
        chart: 'waterfall',
        language: 'pt',
    },
    {
        book: 'personal',
        prompt: 'meus gastos em 2019, só a tabela',
        root: 'Expenses',
        period: '2019',
        view: ['total', 'breakdown', UNSPECIFIED],
        chart: 'table',
        language: 'pt',
    },
    {
        book: 'nimbus',
        prompt: 'ingresos de 2014 comparados con el año anterior',
        root: 'Receitas',
        period: '2014',
        chart: 'compare',
        language: 'es',
    },
    {
        book: 'personal',
        prompt: 'gastos de 2019 por mes en barras apiladas',
        root: 'Expenses',
        period: '2019',
        monthly: true,
        view: ['trend', UNSPECIFIED],
        chart: 'stacked',
        language: 'es',
    },
    {
        book: 'nimbus',
        prompt: 'Ausgaben 2012 als Tortendiagramm',
        root: 'Despesas',
        period: '2012',
        view: ['breakdown', UNSPECIFIED],
        chart: 'pie',
        language: 'de',
    },
    {
        book: 'personal',
        prompt: 'Kontostand meiner Bankkonten Monat für Monat 2019 als Flächendiagramm',
        root: 'Assets',
        period: '2019',
        monthly: true,
        view: ['trend', UNSPECIFIED],
        chart: 'area',
        language: 'de',
    },
    {
        book: 'nimbus',
        prompt: 'Umsatz 2013 nur als Tabelle, ohne Grafik',
        root: 'Receitas',
        period: '2013',
        view: ['total', 'breakdown', UNSPECIFIED],
        chart: 'table',
        language: 'de',
    },
    {
        book: 'nimbus',
        prompt: '2016年の経費を前年と比べて',
        root: 'Despesas',
        period: '2016',
        chart: 'compare',
        language: 'ja',
    },
    {
        book: 'nimbus',
        prompt: '2012年の売上から利益までのウォーターフォール',
        root: NET_RESULT_ROOT,
        period: '2012',
        view: ['breakdown', UNSPECIFIED],
        chart: 'waterfall',
        language: 'ja',
    },
    {
        book: 'personal',
        prompt: '2019年の支出を月別の積み上げグラフで',
        root: 'Expenses',
        period: '2019',
        monthly: true,
        view: ['trend', UNSPECIFIED],
        chart: 'stacked',
        language: 'ja',
    },
    {
        book: 'personal',
        prompt: 'المصروفات في 2019 كمخطط دائري',
        root: 'Expenses',
        period: '2019',
        view: ['breakdown', UNSPECIFIED],
        chart: 'pie',
        language: 'ar',
    },
    {
        book: 'nimbus',
        prompt: 'الإيرادات في 2015 مقارنة بالعام السابق',
        root: 'Receitas',
        period: '2015',
        chart: 'compare',
        language: 'ar',
    },
    {
        book: 'personal',
        prompt: 'مصاريفي في 2019، الأرقام فقط بدون رسم',
        root: 'Expenses',
        period: '2019',
        view: ['total', 'breakdown', UNSPECIFIED],
        chart: 'table',
        language: 'ar',
    },
    {
        book: 'personal',
        prompt: 'mes comptes bancaires mois par mois en 2019, en graphique en aires',
        root: 'Assets',
        period: '2019',
        monthly: true,
        view: ['trend', UNSPECIFIED],
        chart: 'area',
        language: 'fr',
    },
    {
        book: 'nimbus',
        prompt: '2014年支出与上一年对比',
        root: 'Despesas',
        period: '2014',
        chart: 'compare',
        language: 'zh-CN',
    },
    {
        book: 'nimbus',
        prompt: 'despesas por categoria em 2017',
        root: 'Despesas',
        period: '2017',
        view: 'breakdown',
        language: 'pt',
    },
    {
        book: 'nimbus',
        prompt: 'revenue month by month in 2015',
        root: 'Receitas',
        period: '2015',
        monthly: true,
        view: 'trend',
        language: 'en',
    },
    {
        book: 'personal',
        prompt: 'ingresos versus gastos en 2019',
        root: [NET_RESULT_ROOT, 'Net income'],
        period: '2019',
        language: 'es',
    },
    {
        book: 'nimbus',
        prompt: 'die größten Ausgaben 2015',
        root: 'Despesas',
        period: '2015',
        view: 'breakdown',
        language: 'de',
    },
    {
        book: 'personal',
        prompt: '2019年の銀行口座の残高',
        root: 'Assets',
        period: ['2019', '2019-12', '2019-Q4'],
        view: ['total', UNSPECIFIED],
        language: 'ja',
    },
    {
        book: 'personal',
        prompt: 'كم أنفقت على الطعام في 2019؟',
        root: ['Expenses', 'Net income'],
        period: '2019',
        view: ['total', UNSPECIFIED],
        language: 'ar',
    },

    // Short chart requests, in many languages.
    {
        book: 'nimbus',
        prompt: 'despesas em pizza',
        root: 'Despesas',
        period: UNSPECIFIED,
        intentPeriod: '2018',
        view: ['breakdown', UNSPECIFIED],
        chart: 'pie',
        language: 'pt',
    },
    {
        book: 'nimbus',
        prompt: 'despesas 2017 pizza',
        root: 'Despesas',
        period: '2017',
        view: ['breakdown', UNSPECIFIED],
        chart: 'pie',
        language: 'pt',
    },
    {
        book: 'personal',
        prompt: 'gastos en barras',
        root: 'Expenses',
        period: UNSPECIFIED,
        intentPeriod: '2019',
        view: ['breakdown', UNSPECIFIED],
        chart: 'ranked-bar',
        language: 'es',
    },
    {
        book: 'personal',
        prompt: 'Ausgaben als Torte',
        root: 'Expenses',
        period: UNSPECIFIED,
        intentPeriod: '2019',
        view: ['breakdown', UNSPECIFIED],
        chart: 'pie',
        language: 'de',
    },
    {
        book: 'personal',
        prompt: '費用 円グラフ',
        root: 'Expenses',
        period: UNSPECIFIED,
        intentPeriod: '2019',
        view: ['breakdown', UNSPECIFIED],
        chart: 'pie',
        language: 'ja',
    },
    {
        book: 'personal',
        prompt: 'المصروفات دائري',
        root: 'Expenses',
        period: UNSPECIFIED,
        intentPeriod: '2019',
        view: ['breakdown', UNSPECIFIED],
        chart: 'pie',
        language: 'ar',
    },
    {
        book: 'nimbus',
        prompt: 'lucro em cascata',
        root: NET_RESULT_ROOT,
        period: UNSPECIFIED,
        intentPeriod: '2018',
        view: ['breakdown', UNSPECIFIED],
        chart: 'waterfall',
        language: 'pt',
    },
    {
        book: 'nimbus',
        prompt: 'dépenses 2015 en camembert',
        root: 'Despesas',
        period: '2015',
        view: ['breakdown', UNSPECIFIED],
        chart: 'pie',
        language: 'fr',
    },
    {
        book: 'personal',
        prompt: '2019年支出饼图',
        root: 'Expenses',
        period: '2019',
        view: ['breakdown', UNSPECIFIED],
        chart: 'pie',
        language: 'zh-CN',
    },
    {
        book: 'nimbus',
        prompt: 'profit bridge 2016',
        root: NET_RESULT_ROOT,
        period: '2016',
        view: ['breakdown', UNSPECIFIED],
        chart: 'waterfall',
        language: 'en',
    },
    {
        book: 'nimbus',
        prompt: 'receitas mês a mês em 2016 em linha',
        root: 'Receitas',
        period: '2016',
        monthly: true,
        view: ['trend', UNSPECIFIED],
        chart: 'line',
        language: 'pt',
    },
    {
        book: 'personal',
        prompt: 'expenses by month in 2019 as bars',
        root: 'Expenses',
        period: '2019',
        monthly: true,
        view: ['trend', UNSPECIFIED],
        chart: 'bar',
        language: 'en',
    },
    {
        book: 'nimbus',
        prompt: 'Umsatz 2014 im Vergleich zum Vorjahr als Balken',
        root: 'Receitas',
        period: '2014',
        view: ['breakdown', UNSPECIFIED],
        chart: 'compare',
        language: 'de',
    },
    {
        book: 'personal',
        prompt: 'expenses by category, month by month in 2019',
        root: 'Expenses',
        period: '2019',
        monthly: true,
        view: ['trend', UNSPECIFIED],
        chart: 'stacked',
        language: 'en',
    },
];

const QUESTIONS = ['root', 'period', 'monthly', 'view', 'chart', 'language', 'intent'] as const;
type Measure = (typeof QUESTIONS)[number];

class MemoryStore implements SnapshotStore {
    private readonly values = new Map<string, string>();
    async get(key: string) {
        return this.values.get(key) ?? null;
    }
    async put(key: string, value: string) {
        this.values.set(key, value);
    }
}

const accepts = (accepted: Accepted | undefined, value: string | undefined) =>
    accepted === undefined ? true : ([] as string[]).concat(accepted).includes(value ?? '');

function percentile(values: number[], p: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function rootName(snapshot: Snapshot, root: string | undefined): string {
    if (root === undefined) {
        return NONE;
    }
    return snapshot.groups[root]?.name ?? root;
}

async function main(): Promise<void> {
    const only = process.argv
        .filter(arg => arg.startsWith('--only='))
        .flatMap(arg => arg.slice(7).split(','))
        .map(Number);
    const bkperToken = execFileSync('bkper', ['auth', 'token'], { encoding: 'utf8' }).trim();
    const aiToken = process.env.BKPER_AI_TOKEN || bkperToken;
    const bkper = new Bkper({ oauthTokenProvider: async () => bkperToken });
    const kv = new MemoryStore();
    const snapshots = {} as Record<BookKey, Snapshot>;
    for (const key of Object.keys(BOOKS) as BookKey[]) {
        snapshots[key] = await loadSnapshot(BOOKS[key], { bkper, kv, timing: new ServerTiming() });
    }
    const client = createDecisionClient({
        apiKey: aiToken,
        headers: { 'bkper-ai-source': 'report-eval-intent' },
    });

    const hits = Object.fromEntries(QUESTIONS.map(q => [q, 0])) as Record<Measure, number>;
    const totals = Object.fromEntries(QUESTIONS.map(q => [q, 0])) as Record<Measure, number>;
    const latencies: number[] = [];
    const tokens: number[] = [];
    const models = new Set<string>();

    for (const [index, test] of CASES.entries()) {
        const number = index + 1;
        if (only.length > 0 && !only.includes(number)) {
            continue;
        }
        const snapshot = snapshots[test.book];
        const { request, roots } = buildIntentRequest(test.prompt, snapshot);
        const start = performance.now();
        const result = await decide(client, request);
        latencies.push(performance.now() - start);
        tokens.push(result.usage.input_tokens);
        models.add(result.model);

        const { answers } = result;
        const hashtags = extractHashtags(test.prompt);
        const resolution = readIntent(answers, roots, snapshot, hashtags);
        const isReport = !([] as string[]).concat(test.root).includes(NONE);
        const sure = (answer: { choice: string; confidence: number }, threshold: number) =>
            answer.confidence >= threshold ? answer.choice : UNSPECIFIED;
        const intent = resolution.recognized ? resolution.intent : undefined;
        const got = {
            root: rootName(snapshot, intent?.root),
            period: sure(answers.period, THRESHOLDS.period),
            monthly: intent?.monthly ?? false,
            view: intent?.view ?? UNSPECIFIED,
            chart: intent?.chart ?? 'auto',
            language: resolution.language,
        };
        const checks: Partial<Record<Measure, boolean>> = {
            root: accepts(test.root, got.root),
            language: got.language === test.language,
        };
        if (isReport) {
            const expectedPeriod = test.intentPeriod ?? test.period;
            checks.period = accepts(test.period, got.period);
            checks.monthly = got.monthly === (test.monthly ?? false);
            checks.view = accepts(test.view ?? UNSPECIFIED, got.view);
            checks.chart = got.chart === (test.chart ?? 'auto');
            checks.intent =
                intent !== undefined &&
                checks.root &&
                accepts(expectedPeriod, intent.period) &&
                checks.monthly &&
                checks.view &&
                checks.chart &&
                (intent.hashtags ?? []).join() === hashtags.join();
        } else {
            checks.intent = !resolution.recognized;
        }
        for (const [question, ok] of Object.entries(checks) as [Measure, boolean][]) {
            totals[question]++;
            hits[question] += ok ? 1 : 0;
        }

        const misses = Object.entries(checks)
            .filter(([, ok]) => !ok)
            .map(([question]) => question);
        const yes = (answer: { noul: number }) => answer.noul.toFixed(2);
        const detail =
            `root=${got.root}(${answers.root.confidence.toFixed(2)})` +
            ` period=${answers.period.choice}(${answers.period.confidence.toFixed(2)})` +
            `→${intent?.period ?? '-'}` +
            ` over_time=${yes(answers.over_time)} composition=${yes(answers.composition)}` +
            ` versus_earlier=${yes(answers.versus_earlier)} bridge=${yes(answers.bridge)}` +
            ` chart_named=${answers.chart_named.choice}(${answers.chart_named.confidence.toFixed(2)})` +
            ` → ${resolution.recognized ? resolution.trace.rule : '-'}: monthly=${got.monthly} view=${got.view} chart=${got.chart}` +
            ` lang=${answers.language.choice}(${answers.language.confidence.toFixed(2)})`;
        const trace =
            misses.length > 0 && resolution.recognized
                ? `\n       trace: ${JSON.stringify(resolution.trace)}`
                : '';
        console.log(
            `${misses.length === 0 ? 'ok  ' : 'MISS'} #${number} ${Math.round(latencies.at(-1) ?? 0)}ms "${test.prompt}"` +
                `\n       ${detail}${misses.length ? `\n       wrong: ${misses.join(', ')}${trace}` : ''}`
        );
    }

    console.log(`\nModel: ${[...models].join(', ')}`);
    for (const question of QUESTIONS) {
        const pct = totals[question] ? (100 * hits[question]) / totals[question] : 0;
        console.log(
            `${question.padEnd(9)} ${hits[question]}/${totals[question]} (${pct.toFixed(0)}%)`
        );
    }
    console.log(
        `latency   p50 ${Math.round(percentile(latencies, 50))} ms, p95 ${Math.round(percentile(latencies, 95))} ms, ` +
            `max ${Math.round(Math.max(...latencies))} ms over ${latencies.length} calls; ` +
            `input tokens p50 ${percentile(tokens, 50)}`
    );
}

await main();
