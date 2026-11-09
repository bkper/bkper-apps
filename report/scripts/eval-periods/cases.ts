/**
 * Requests that name a period, and the period a person means by each, written as the parts of
 * `server/src/services/period-query.ts` from what an accountant or a business owner expects to
 * see, never from what a model answers. Scoring builds the query of the expected parts and of
 * the parts a model gives, at the case's `today`, and compares the months they read.
 *
 * Where a request is genuinely ambiguous the expectation names no period (the default); where
 * two readings are equally right, `expected` lists both. Members of a paraphrase `group` mean
 * the same thing: same today, nature and expectation.
 */
import type { PeriodRequest } from '../../server/src/services/period-query.ts';
import type { IsoDate, ReportNature } from '../../server/src/services/periods.ts';

export const CATEGORIES = [
    /** A year, month or quarter written in the request, old ones too. */
    'named',
    /** Finished periods relative to today: last month, last year, the last 12 months, all time. */
    'relative',
    /** Periods that contain the current month: this month, quarter or year, year to date. */
    'running',
    /** A month or quarter with no year, before and after today's. */
    'no_year',
    /** Compared with the previous period. */
    'default_comparison',
    /** Compared with the same period a year earlier. */
    'year_earlier',
    /** Compared with another period the request names. */
    'named_comparison',
    /** A relative period compared with a written one, or the other way round. */
    'mixed_comparison',
    /** Balances now, at the end of past periods, and compared. */
    'balance',
    /** Periods that have not started. */
    'future',
    /** A comparison that is later than the period, or another kind of period. */
    'invalid_comparison',
    /** No period at all: the report reads its default one. */
    'no_period',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const BOOKS = {
    nimbus: 'agtzfmJrcGVyLWhyZHINCxIGTGVkZ2VyGNEPDA',
    personal: 'agtzfmJrcGVyLWhyZHITCxIGTGVkZ2VyGICAgIOLzLQKDA',
} as const;

export type BookKey = keyof typeof BOOKS;

/** The period meant, or several equally right readings. */
export type Expected = PeriodRequest | readonly PeriodRequest[];

export interface PeriodCase {
    prompt: string;
    language: string;
    /** Nimbus (Portuguese groups) or Personal finances (English groups). */
    book: BookKey;
    /** Activity (Incoming, Outgoing) or a position (Asset, Liability), from the request's subject. */
    nature: ReportNature;
    today: IsoDate;
    category: Category;
    /** Paraphrases of one meaning share a group. */
    group?: string;
    expected: Expected;
}

/** January: last month is in the year before. */
export const JAN = '2026-01-15';
/** The last day of a quarter. */
export const MAR = '2026-03-31';
export const NOV = '2026-11-09';
/** The last day of the year. */
export const DEC = '2026-12-31';
/** A leap day. */
export const LEAP = '2028-02-29';

type Prompt = readonly [language: string, prompt: string];

interface Setting {
    category: Category;
    today: IsoDate;
    book: BookKey;
    nature: ReportNature;
    expected: Expected;
}

function group(id: string, setting: Setting, prompts: readonly Prompt[]): PeriodCase[] {
    return prompts.map(([language, prompt]) => ({ ...setting, language, prompt, group: id }));
}

function singles(setting: Setting, prompts: readonly Prompt[]): PeriodCase[] {
    return prompts.map(([language, prompt]) => ({ ...setting, language, prompt }));
}

const A: ReportNature = 'activity';
const P: ReportNature = 'position';
const NONE: PeriodRequest = { period: {} };
const NOW: PeriodRequest = { period: { span: 'now' } };

/** "At the end of" a year: the year, its last quarter or its last month are equally right. */
function endOfYear(year: PeriodRequest['period']['year']): PeriodRequest[] {
    return [
        { period: { span: 'year', year } },
        { period: { span: 'quarter', year, quarter: 4 } },
        { period: { span: 'month', year, month: 12 } },
    ];
}

const named: PeriodCase[] = [
    ...group(
        'year-2015',
        {
            category: 'named',
            today: NOV,
            book: 'nimbus',
            nature: A,
            expected: { period: { year: 2015 } },
        },
        [
            ['en', 'expenses in 2015'],
            ['en', '2015 expenses'],
            ['en', 'how much did we spend in 2015?'],
            ['en', 'expenses for the year 2015'],
            ['en', 'expnses in 2015'],
            ['pt', 'despesas de 2015'],
            ['pt', 'quanto gastamos em 2015'],
            ['es', 'gastos de 2015'],
            ['fr', 'dépenses en 2015'],
            ['de', 'Ausgaben 2015'],
            ['it', 'spese del 2015'],
            ['ja', '2015年の費用'],
            ['ja', '２０１５年の費用'],
            ['zh-CN', '2015年的支出'],
            ['ar', 'المصروفات في عام ٢٠١٥'],
            ['he', 'הוצאות בשנת 2015'],
            ['hi', '2015 में खर्च'],
            ['hi', '२०१५ में खर्च'],
            ['ko', '2015년 지출'],
            ['ru', 'расходы за 2015 год'],
        ]
    ),
    ...group(
        'year-2009',
        {
            category: 'named',
            today: NOV,
            book: 'nimbus',
            nature: A,
            expected: { period: { year: 2009 } },
        },
        [
            ['en', 'revenue in 2009'],
            ['pt', 'receitas de 2009'],
            ['de', 'Einnahmen im Jahr 2009'],
            ['ja', '2009年の収入'],
        ]
    ),
    ...singles(
        {
            category: 'named',
            today: NOV,
            book: 'nimbus',
            nature: A,
            expected: { period: { year: 2005 } },
        },
        [
            ['en', 'revenue for 2005'],
            ['es', 'ingresos de 2005'],
        ]
    ),
    ...singles(
        {
            category: 'named',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 1998 } },
        },
        [['en', 'expenses in 1998']]
    ),
    ...group(
        'year-2024-fy',
        {
            category: 'named',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2024 } },
        },
        [
            ['en', 'expenses FY2024'],
            ['en', 'expenses for calendar year 2024'],
            ['nl', 'uitgaven in 2024'],
        ]
    ),
    ...group(
        'month-2012-01',
        {
            category: 'named',
            today: NOV,
            book: 'nimbus',
            nature: A,
            expected: { period: { year: 2012, month: 1 } },
        },
        [
            ['en', 'expenses in January 2012'],
            ['en', 'Jan 2012 expenses'],
            ['en', 'expenses 2012-01'],
            ['pt', 'despesas de janeiro de 2012'],
            ['es', 'gastos de enero de 2012'],
            ['fr', 'dépenses de janvier 2012'],
            ['de', 'Ausgaben im Januar 2012'],
            ['it', 'spese di gennaio 2012'],
            ['ja', '2012年1月の費用'],
            ['zh-CN', '2012年1月的支出'],
            ['ar', 'مصروفات يناير ٢٠١٢'],
            ['he', 'הוצאות ינואר 2012'],
            ['hi', 'जनवरी 2012 के खर्च'],
            ['ko', '2012년 1월 지출'],
            ['ru', 'расходы за январь 2012'],
        ]
    ),
    ...group(
        'month-2025-03',
        {
            category: 'named',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2025, month: 3 } },
        },
        [
            ['en', 'expenses in March 2025'],
            ['en', 'Mar 2025 expenses'],
            ['pt', 'gastos em março de 2025'],
            ['es', 'gastos de marzo 2025'],
            ['fr', 'dépenses mars 2025'],
            ['de', 'Ausgaben März 2025'],
            ['ja', '2025年3月の支出'],
            ['ar', 'مصروفات مارس ٢٠٢٥'],
        ]
    ),
    ...group(
        'month-2025-02-typo',
        {
            category: 'named',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2025, month: 2 } },
        },
        [
            ['en', 'expenses in Febuary 2025'],
            ['en', 'expenses in February 2025'],
            ['it', 'spese di febbraio 2025'],
        ]
    ),
    ...group(
        'month-2017-12',
        {
            category: 'named',
            today: NOV,
            book: 'nimbus',
            nature: A,
            expected: { period: { year: 2017, month: 12 } },
        },
        [
            ['pt', 'receitas de dezembro de 2017'],
            ['en', 'revenue December 2017'],
            ['zh-CN', '2017年12月的收入'],
            ['he', 'הכנסות דצמבר 2017'],
        ]
    ),
    ...group(
        'quarter-2016-3',
        {
            category: 'named',
            today: NOV,
            book: 'nimbus',
            nature: A,
            expected: { period: { year: 2016, quarter: 3 } },
        },
        [
            ['en', 'expenses in Q3 2016'],
            ['en', 'Q3 2016 expenses'],
            ['en', 'third quarter of 2016 expenses'],
            ['en', 'expenses for 3Q 2016'],
            ['en', 'expneses Q3 2016'],
            ['pt', 'despesas do terceiro trimestre de 2016'],
            ['pt', 'despesas 3º tri 2016'],
            ['es', 'gastos del tercer trimestre de 2016'],
            ['fr', 'dépenses du troisième trimestre 2016'],
            ['de', 'Ausgaben im dritten Quartal 2016'],
            ['de', 'Ausgaben Q3/2016'],
            ['it', 'spese del terzo trimestre 2016'],
            ['ja', '2016年第3四半期の費用'],
            ['zh-CN', '2016年第三季度支出'],
            ['ar', 'مصروفات الربع الثالث من 2016'],
            ['he', 'הוצאות ברבעון השלישי של 2016'],
            ['hi', '2016 की तीसरी तिमाही के खर्च'],
        ]
    ),
    ...group(
        'quarter-2024-1',
        {
            category: 'named',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2024, quarter: 1 } },
        },
        [
            ['en', 'revenue Q1 2024'],
            ['es', 'ingresos del primer trimestre de 2024'],
            ['fr', 'revenus T1 2024'],
            ['de', 'Umsatz Q1 2024'],
            ['ja', '2024年第1四半期の収入'],
        ]
    ),
    ...singles(
        {
            category: 'named',
            today: JAN,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2025 } },
        },
        [
            ['en', 'expenses in 2025'],
            ['pt', 'despesas de 2025'],
        ]
    ),
    ...singles(
        {
            category: 'named',
            today: LEAP,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2027, quarter: 4 } },
        },
        [['en', 'expenses Q4 2027']]
    ),
];

const relative: PeriodCase[] = [
    ...group(
        'last-month-nov',
        {
            category: 'relative',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { month: 'previous' } },
        },
        [
            ['en', 'expenses last month'],
            ['en', "last month's expenses"],
            ['en', 'what did I spend last month?'],
            ['en', 'expenses previous month'],
            ['en', 'expenses las month'],
            ['pt', 'despesas do mês passado'],
            ['pt', 'despesas do mes passado'],
            ['es', 'gastos del mes pasado'],
            ['fr', 'dépenses du mois dernier'],
            ['de', 'Ausgaben letzten Monat'],
            ['it', 'spese del mese scorso'],
            ['ja', '先月の支出'],
            ['zh-CN', '上个月的支出'],
            ['ar', 'مصروفات الشهر الماضي'],
            ['he', 'הוצאות בחודש שעבר'],
            ['hi', 'पिछले महीने के खर्च'],
            ['ko', '지난달 지출'],
        ]
    ),
    ...group(
        'last-month-jan',
        {
            category: 'relative',
            today: JAN,
            book: 'personal',
            nature: A,
            expected: { period: { month: 'previous' } },
        },
        [
            ['en', 'expenses last month'],
            ['pt', 'despesas do mês passado'],
            ['es', 'gastos del mes pasado'],
            ['de', 'Ausgaben im letzten Monat'],
            ['ja', '先月の費用'],
            ['ar', 'مصروفات الشهر الماضي'],
        ]
    ),
    ...group(
        'last-month-leap',
        {
            category: 'relative',
            today: LEAP,
            book: 'personal',
            nature: A,
            expected: { period: { month: 'previous' } },
        },
        [
            ['en', 'expenses last month'],
            ['fr', 'dépenses du mois dernier'],
        ]
    ),
    ...group(
        'last-year-nov',
        {
            category: 'relative',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 'previous' } },
        },
        [
            ['en', 'expenses last year'],
            ['en', "last year's expenses"],
            ['en', 'how much did we spend in the previous year'],
            ['en', 'expenses lst year'],
            ['pt', 'despesas do ano passado'],
            ['es', 'gastos del año pasado'],
            ['es', 'gastos del ano pasado'],
            ['fr', "dépenses de l'année dernière"],
            ['de', 'Ausgaben letztes Jahr'],
            ['it', "spese dell'anno scorso"],
            ['ja', '昨年の費用'],
            ['zh-CN', '去年的支出'],
            ['ar', 'مصروفات العام الماضي'],
            ['he', 'הוצאות בשנה שעברה'],
            ['hi', 'पिछले साल के खर्च'],
        ]
    ),
    ...group(
        'last-year-jan',
        {
            category: 'relative',
            today: JAN,
            book: 'personal',
            nature: A,
            expected: { period: { year: 'previous' } },
        },
        [
            ['en', 'revenue last year'],
            ['pt', 'receitas do ano passado'],
            ['de', 'Einnahmen im Vorjahr'],
        ]
    ),
    ...group(
        'year-before-last',
        {
            category: 'relative',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 'before_previous' } },
        },
        [
            ['en', 'expenses the year before last'],
            ['en', 'expenses two years ago'],
            ['pt', 'despesas de dois anos atrás'],
            ['pt', 'despesas do ano retrasado'],
            ['es', 'gastos del año antepasado'],
            ['de', 'Ausgaben vorletztes Jahr'],
            ['fr', "dépenses d'il y a deux ans"],
            ['it', 'spese di due anni fa'],
            ['ja', '一昨年の費用'],
            ['zh-CN', '前年的支出'],
        ]
    ),
    ...group(
        'last-quarter-nov',
        {
            category: 'relative',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { quarter: 'previous' } },
        },
        [
            ['en', 'expenses last quarter'],
            ['en', 'last qtr expenses'],
            ['en', 'expenses in the previous quarter'],
            ['pt', 'despesas do trimestre passado'],
            ['es', 'gastos del trimestre pasado'],
            ['fr', 'dépenses du trimestre dernier'],
            ['de', 'Ausgaben im letzten Quartal'],
            ['ja', '前四半期の費用'],
            ['zh-CN', '上季度的支出'],
            ['ar', 'مصروفات الربع الماضي'],
            ['he', 'הוצאות ברבעון הקודם'],
            ['hi', 'पिछली तिमाही के खर्च'],
        ]
    ),
    ...group(
        'last-quarter-mar',
        {
            category: 'relative',
            today: MAR,
            book: 'personal',
            nature: A,
            expected: { period: { quarter: 'previous' } },
        },
        [
            ['en', 'expenses last quarter'],
            ['pt', 'despesas do trimestre passado'],
            ['de', 'Ausgaben letztes Quartal'],
        ]
    ),
    ...group(
        'last-12-months-nov',
        {
            category: 'relative',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { span: 'last_12_months' } },
        },
        [
            ['en', 'expenses in the last 12 months'],
            ['en', 'expenses LTM'],
            ['en', 'trailing twelve months expenses'],
            ['en', 'TTM expenses'],
            ['pt', 'despesas dos últimos 12 meses'],
            ['es', 'gastos de los últimos doce meses'],
            ['fr', 'dépenses des 12 derniers mois'],
            ['de', 'Ausgaben der letzten 12 Monate'],
            ['it', 'spese degli ultimi 12 mesi'],
            ['ja', '過去12か月の支出'],
            ['ja', '過去１２か月の支出'],
            ['zh-CN', '过去12个月的支出'],
            ['ar', 'مصروفات آخر ١٢ شهرًا'],
            ['he', 'הוצאות ב-12 החודשים האחרונים'],
            ['hi', 'पिछले 12 महीनों के खर्च'],
        ]
    ),
    ...group(
        'last-12-months-dec',
        {
            category: 'relative',
            today: DEC,
            book: 'personal',
            nature: A,
            expected: { period: { span: 'last_12_months' } },
        },
        [
            ['en', 'expenses last 12 months'],
            ['pt', 'despesas dos últimos 12 meses'],
        ]
    ),
    ...group(
        'all-time',
        {
            category: 'relative',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { span: 'all_time' } },
        },
        [
            ['en', 'expenses all time'],
            ['en', 'total expenses since the beginning'],
            ['en', 'expenses since inception'],
            ['pt', 'despesas desde o início'],
            ['es', 'gastos desde el principio'],
            ['fr', 'dépenses depuis le début'],
            ['de', 'Ausgaben seit Beginn'],
            ['ja', '全期間の支出'],
            ['zh-CN', '全部时间的支出'],
        ]
    ),
    ...group(
        'january-last-year',
        {
            category: 'relative',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 'previous', month: 1 } },
        },
        [
            ['en', 'expenses in January last year'],
            ['pt', 'despesas de janeiro do ano passado'],
            ['es', 'gastos de enero del año pasado'],
            ['de', 'Ausgaben im Januar letzten Jahres'],
            ['ja', '昨年1月の支出'],
        ]
    ),
    ...group(
        'december-last-year-mar',
        {
            category: 'relative',
            today: MAR,
            book: 'personal',
            nature: A,
            expected: { period: { year: 'previous', month: 12 } },
        },
        [
            ['en', 'expenses in December last year'],
            ['pt', 'despesas de dezembro do ano passado'],
        ]
    ),
    ...group(
        'q2-last-year',
        {
            category: 'relative',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 'previous', quarter: 2 } },
        },
        [
            ['en', 'expenses in Q2 last year'],
            ['fr', "dépenses du deuxième trimestre de l'année dernière"],
        ]
    ),
];

const running: PeriodCase[] = [
    ...group(
        'this-year-nov',
        {
            category: 'running',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 'current' } },
        },
        [
            ['en', 'expenses this year'],
            ['en', "this year's expenses"],
            ['en', 'expenses so far this year'],
            ['en', 'expenses year to date'],
            ['en', 'YTD expenses'],
            ['en', 'expenses ytd'],
            ['en', 'expenses in 2026'],
            ['en', 'spendng this yr'],
            ['pt', 'despesas deste ano'],
            ['pt', 'despesas no acumulado do ano'],
            ['es', 'gastos en lo que va del año'],
            ['fr', "dépenses depuis le début de l'année"],
            ['de', 'Ausgaben seit Jahresbeginn'],
            ['it', "spese dall'inizio dell'anno"],
            ['ja', '今年の支出'],
            ['ja', '年初来の支出'],
            ['zh-CN', '今年以来的支出'],
            ['ar', 'مصروفات هذا العام'],
            ['he', 'הוצאות השנה'],
            ['hi', 'इस साल के खर्च'],
            ['ko', '올해 지출'],
            ['ru', 'расходы с начала года'],
        ]
    ),
    ...group(
        'this-year-dec',
        {
            category: 'running',
            today: DEC,
            book: 'personal',
            nature: A,
            expected: { period: { year: 'current' } },
        },
        [
            ['en', 'expenses this year'],
            ['en', 'YTD expenses'],
            ['pt', 'despesas deste ano'],
        ]
    ),
    ...group(
        'this-year-jan',
        {
            category: 'running',
            today: JAN,
            book: 'personal',
            nature: A,
            expected: { period: { year: 'current' } },
        },
        [
            ['en', 'expenses this year'],
            ['en', 'YTD expenses'],
            ['es', 'gastos en lo que va del año'],
        ]
    ),
    ...group(
        'this-month-nov',
        {
            category: 'running',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { month: 'current' } },
        },
        [
            ['en', 'expenses this month'],
            ['en', 'expenses this month so far'],
            ['en', 'MTD expenses'],
            ['en', 'month to date expenses'],
            ['en', 'expenses in November 2026'],
            ['pt', 'despesas deste mês'],
            ['es', 'gastos de este mes'],
            ['fr', 'dépenses de ce mois-ci'],
            ['de', 'Ausgaben diesen Monat'],
            ['it', 'spese di questo mese'],
            ['ja', '今月の支出'],
            ['zh-CN', '本月支出'],
            ['ar', 'مصروفات هذا الشهر'],
            ['he', 'הוצאות החודש'],
            ['hi', 'इस महीने के खर्च'],
        ]
    ),
    ...group(
        'today-activity',
        {
            category: 'running',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { span: 'now' } },
        },
        [
            ['en', 'revenue today'],
            ['pt', 'receitas de hoje'],
            ['es', 'ingresos de hoy'],
            ['ja', '今日の収入'],
        ]
    ),
    ...group(
        'this-quarter-nov',
        {
            category: 'running',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { quarter: 'current' } },
        },
        [
            ['en', 'expenses this quarter'],
            ['en', 'QTD expenses'],
            ['en', 'expenses Q4 so far'],
            ['en', 'expenses Q4 2026'],
            ['pt', 'despesas deste trimestre'],
            ['es', 'gastos de este trimestre'],
            ['fr', 'dépenses de ce trimestre'],
            ['de', 'Ausgaben in diesem Quartal'],
            ['ja', '今四半期の支出'],
            ['zh-CN', '本季度支出'],
            ['ar', 'مصروفات هذا الربع'],
            ['he', 'הוצאות ברבעון הזה'],
        ]
    ),
    ...group(
        'this-quarter-mar',
        {
            category: 'running',
            today: MAR,
            book: 'personal',
            nature: A,
            expected: { period: { quarter: 'current' } },
        },
        [
            ['en', 'expenses this quarter'],
            ['pt', 'despesas deste trimestre'],
            ['en', 'Q1 2026 expenses'],
        ]
    ),
    ...group(
        'this-month-leap',
        {
            category: 'running',
            today: LEAP,
            book: 'personal',
            nature: A,
            expected: { period: { month: 'current' } },
        },
        [
            ['en', 'expenses this month'],
            ['de', 'Ausgaben diesen Monat'],
        ]
    ),
    ...group(
        'this-year-leap',
        {
            category: 'running',
            today: LEAP,
            book: 'personal',
            nature: A,
            expected: { period: { year: 'current' } },
        },
        [
            ['en', 'expenses this year'],
            ['pt', 'despesas deste ano'],
        ]
    ),
];

const noYear: PeriodCase[] = [
    ...group(
        'december-in-november',
        {
            category: 'no_year',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { month: 12 } },
        },
        [
            ['en', 'expenses in December'],
            ['pt', 'despesas de dezembro'],
            ['es', 'gastos de diciembre'],
            ['de', 'Ausgaben im Dezember'],
            ['ja', '12月の支出'],
        ]
    ),
    ...group(
        'october-in-november',
        {
            category: 'no_year',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { month: 10 } },
        },
        [
            ['en', 'expenses in October'],
            ['fr', "dépenses d'octobre"],
            ['zh-CN', '10月的支出'],
        ]
    ),
    ...group(
        'november-in-november',
        {
            category: 'no_year',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { month: 11 } },
        },
        [
            ['en', 'expenses in November'],
            ['en', 'expenses in Novmber'],
        ]
    ),
    ...group(
        'march-in-november',
        {
            category: 'no_year',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { month: 3 } },
        },
        [
            ['en', 'expenses in March'],
            ['it', 'spese di marzo'],
            ['ar', 'مصروفات مارس'],
        ]
    ),
    ...group(
        'q1-in-november',
        {
            category: 'no_year',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { quarter: 1 } },
        },
        [
            ['en', 'expenses in Q1'],
            ['de', 'Ausgaben im ersten Quartal'],
        ]
    ),
    ...group(
        'q3-in-november',
        {
            category: 'no_year',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { quarter: 3 } },
        },
        [
            ['en', 'Q3 expenses'],
            ['pt', 'despesas do 3º trimestre'],
            ['he', 'הוצאות ברבעון השלישי'],
        ]
    ),
    ...group(
        'january-in-march',
        {
            category: 'no_year',
            today: MAR,
            book: 'personal',
            nature: A,
            expected: { period: { month: 1 } },
        },
        [
            ['en', 'expenses in January'],
            ['pt', 'despesas de janeiro'],
            ['es', 'gastos de enero'],
            ['ja', '1月の費用'],
        ]
    ),
    ...group(
        'april-in-march',
        {
            category: 'no_year',
            today: MAR,
            book: 'personal',
            nature: A,
            expected: { period: { month: 4 } },
        },
        [
            ['en', 'expenses in April'],
            ['de', 'Ausgaben im April'],
            ['fr', "dépenses d'avril"],
        ]
    ),
    ...singles(
        {
            category: 'no_year',
            today: MAR,
            book: 'personal',
            nature: A,
            expected: { period: { month: 12 } },
        },
        [['en', 'expenses in December']]
    ),
    ...singles(
        {
            category: 'no_year',
            today: MAR,
            book: 'personal',
            nature: A,
            expected: { period: { month: 3 } },
        },
        [['en', 'expenses in March']]
    ),
    ...singles(
        {
            category: 'no_year',
            today: MAR,
            book: 'personal',
            nature: A,
            expected: { period: { quarter: 2 } },
        },
        [['en', 'expenses in Q2']]
    ),
    ...singles(
        {
            category: 'no_year',
            today: MAR,
            book: 'personal',
            nature: A,
            expected: { period: { quarter: 4 } },
        },
        [['en', 'Q4 expenses']]
    ),
    ...singles(
        {
            category: 'no_year',
            today: JAN,
            book: 'personal',
            nature: A,
            expected: { period: { month: 12 } },
        },
        [
            ['en', 'expenses in December'],
            ['pt', 'despesas de dezembro'],
        ]
    ),
    ...singles(
        {
            category: 'no_year',
            today: JAN,
            book: 'personal',
            nature: A,
            expected: { period: { month: 2 } },
        },
        [['en', 'expenses in February']]
    ),
    ...singles(
        {
            category: 'no_year',
            today: JAN,
            book: 'personal',
            nature: A,
            expected: { period: { month: 1 } },
        },
        [['en', 'expenses in January']]
    ),
    ...singles(
        {
            category: 'no_year',
            today: JAN,
            book: 'personal',
            nature: A,
            expected: { period: { quarter: 4 } },
        },
        [
            ['en', 'Q4 expenses'],
            ['es', 'gastos del cuarto trimestre'],
        ]
    ),
    ...singles(
        {
            category: 'no_year',
            today: DEC,
            book: 'personal',
            nature: A,
            expected: { period: { month: 12 } },
        },
        [['en', 'expenses in December']]
    ),
    ...singles(
        {
            category: 'no_year',
            today: DEC,
            book: 'personal',
            nature: A,
            expected: { period: { quarter: 4 } },
        },
        [['en', 'expenses in Q4']]
    ),
    ...singles(
        {
            category: 'no_year',
            today: DEC,
            book: 'personal',
            nature: A,
            expected: { period: { month: 1 } },
        },
        [['fr', 'dépenses de janvier']]
    ),
    ...singles(
        {
            category: 'no_year',
            today: LEAP,
            book: 'personal',
            nature: A,
            expected: { period: { month: 2 } },
        },
        [['en', 'expenses in February']]
    ),
    ...singles(
        {
            category: 'no_year',
            today: LEAP,
            book: 'personal',
            nature: A,
            expected: { period: { month: 3 } },
        },
        [['en', 'expenses in March']]
    ),
];

const defaultComparison: PeriodCase[] = [
    ...group(
        'last-month-vs-previous',
        {
            category: 'default_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { month: 'previous' } },
        },
        [
            ['en', 'expenses last month vs the previous month'],
            ['en', 'expenses last month compared to the month before'],
            ['en', 'last month expenses MoM'],
            ['pt', 'despesas do mês passado comparadas com o mês anterior'],
            ['es', 'gastos del mes pasado frente al mes anterior'],
            ['de', 'Ausgaben letzten Monat im Vergleich zum Vormonat'],
        ]
    ),
    ...group(
        'this-month-vs-last',
        {
            category: 'default_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { month: 'current' } },
        },
        [
            ['en', 'expenses this month compared to last month'],
            ['en', 'this month vs last month expenses'],
            ['pt', 'despesas deste mês contra o mês passado'],
            ['fr', 'dépenses de ce mois par rapport au mois dernier'],
            ['ja', '今月と先月の支出の比較'],
            ['zh-CN', '本月与上月支出对比'],
            ['he', 'הוצאות החודש לעומת החודש שעבר'],
        ]
    ),
    ...group(
        'year-2016-vs-previous',
        {
            category: 'default_comparison',
            today: NOV,
            book: 'nimbus',
            nature: A,
            expected: { period: { year: 2016 } },
        },
        [
            ['en', 'expenses 2016 vs previous year'],
            ['en', 'expenses 2016 compared with the year before'],
            ['pt', 'despesas de 2016 comparadas com o ano anterior'],
            ['de', 'Ausgaben 2016 gegenüber dem Vorjahr'],
            ['ar', 'مصروفات ٢٠١٦ مقارنة بالعام السابق'],
        ]
    ),
    ...group(
        'q3-2016-vs-previous',
        {
            category: 'default_comparison',
            today: NOV,
            book: 'nimbus',
            nature: A,
            expected: { period: { year: 2016, quarter: 3 } },
        },
        [
            ['en', 'expenses Q3 2016 vs previous quarter'],
            ['pt', 'despesas do terceiro trimestre de 2016 contra o trimestre anterior'],
            ['es', 'gastos del tercer trimestre de 2016 frente al trimestre anterior'],
            ['it', 'spese del terzo trimestre 2016 rispetto al trimestre precedente'],
        ]
    ),
    ...group(
        'this-year-vs-last',
        {
            category: 'default_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 'current' } },
        },
        [
            ['en', 'expenses this year vs last year'],
            ['en', 'this year compared to last year expenses'],
            ['pt', 'despesas deste ano versus o ano passado'],
            ['es', 'gastos de este año comparados con el año pasado'],
            ['fr', "dépenses de cette année par rapport à l'an dernier"],
            ['de', 'Ausgaben dieses Jahr im Vergleich zum Vorjahr'],
            ['ja', '今年と昨年の支出比較'],
            ['hi', 'इस साल बनाम पिछले साल के खर्च'],
        ]
    ),
    ...group(
        'last-12-months-vs-previous',
        {
            category: 'default_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { span: 'last_12_months' } },
        },
        [
            ['en', 'expenses last 12 months vs the 12 months before'],
            ['en', 'LTM revenue vs prior LTM'],
            ['pt', 'despesas dos últimos 12 meses contra os 12 meses anteriores'],
        ]
    ),
    ...group(
        'this-month-vs-last-jan',
        {
            category: 'default_comparison',
            today: JAN,
            book: 'personal',
            nature: A,
            expected: { period: { month: 'current' } },
        },
        [
            ['en', 'expenses this month vs last month'],
            ['pt', 'despesas deste mês comparadas com o mês passado'],
        ]
    ),
    ...singles(
        {
            category: 'default_comparison',
            today: JAN,
            book: 'personal',
            nature: A,
            expected: { period: { month: 'previous' } },
        },
        [['en', 'expenses last month vs the month before']]
    ),
    ...group(
        'this-quarter-vs-last-mar',
        {
            category: 'default_comparison',
            today: MAR,
            book: 'personal',
            nature: A,
            expected: { period: { quarter: 'current' } },
        },
        [
            ['en', 'expenses this quarter vs last quarter'],
            ['de', 'Ausgaben dieses Quartal im Vergleich zum Vorquartal'],
        ]
    ),
    ...singles(
        {
            category: 'default_comparison',
            today: MAR,
            book: 'personal',
            nature: A,
            expected: { period: { quarter: 'previous' } },
        },
        [['en', 'expenses last quarter compared with the quarter before']]
    ),
    ...group(
        'june-2019-vs-previous',
        {
            category: 'default_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2019, month: 6 } },
        },
        [
            ['en', 'expenses in June 2019 compared with the previous month'],
            ['es', 'gastos de junio de 2019 frente al mes anterior'],
        ]
    ),
];

const yearEarlier: PeriodCase[] = [
    ...group(
        'last-month-yoy',
        {
            category: 'year_earlier',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { month: 'previous' }, compareWith: 'year_earlier' },
        },
        [
            ['en', 'expenses last month vs the same month last year'],
            ['en', 'last month expenses YoY'],
            ['en', 'expenses last month compared with October last year'],
            ['pt', 'despesas do mês passado comparadas com o mesmo mês do ano anterior'],
            ['es', 'gastos del mes pasado frente al mismo mes del año anterior'],
            ['fr', "dépenses du mois dernier par rapport au même mois l'an dernier"],
            ['de', 'Ausgaben letzten Monat im Vergleich zum Vorjahresmonat'],
            ['it', "spese del mese scorso rispetto allo stesso mese dell'anno scorso"],
            ['ja', '先月の支出を前年同月と比較'],
            ['zh-CN', '上个月支出同比'],
        ]
    ),
    ...group(
        'this-month-yoy',
        {
            category: 'year_earlier',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { month: 'current' }, compareWith: 'year_earlier' },
        },
        [
            ['en', 'expenses this month vs the same month last year'],
            ['en', 'this month expenses year over year'],
            ['en', 'expenses this month vs last year'],
            ['pt', 'despesas deste mês contra o mesmo mês do ano passado'],
            ['ar', 'مصروفات هذا الشهر مقارنة بنفس الشهر من العام الماضي'],
            ['he', 'הוצאות החודש לעומת אותו חודש בשנה שעברה'],
        ]
    ),
    ...group(
        'q3-2016-yoy',
        {
            category: 'year_earlier',
            today: NOV,
            book: 'nimbus',
            nature: A,
            expected: { period: { year: 2016, quarter: 3 }, compareWith: 'year_earlier' },
        },
        [
            ['en', 'expenses Q3 2016 vs Q3 2015'],
            ['en', 'expenses Q3 2016 year over year'],
            ['pt', 'despesas do terceiro trimestre de 2016 em relação ao mesmo trimestre de 2015'],
            ['de', 'Ausgaben Q3 2016 gegenüber Q3 2015'],
        ]
    ),
    ...group(
        'this-quarter-yoy',
        {
            category: 'year_earlier',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { quarter: 'current' }, compareWith: 'year_earlier' },
        },
        [
            ['en', 'expenses this quarter vs the same quarter last year'],
            ['es', 'gastos de este trimestre frente al mismo trimestre del año pasado'],
        ]
    ),
    ...group(
        'ytd-yoy',
        {
            category: 'year_earlier',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { span: 'year_to_date' }, compareWith: 'year_earlier' },
        },
        [
            ['en', 'YTD expenses vs same period last year'],
            ['en', 'expenses year to date vs last year'],
            [
                'fr',
                "dépenses depuis le début de l'année par rapport à la même période l'an dernier",
            ],
        ]
    ),
    ...group(
        'last-month-yoy-jan',
        {
            category: 'year_earlier',
            today: JAN,
            book: 'personal',
            nature: A,
            expected: { period: { month: 'previous' }, compareWith: 'year_earlier' },
        },
        [
            ['en', 'expenses last month vs the same month a year before'],
            ['pt', 'despesas do mês passado contra o mesmo mês do ano anterior'],
        ]
    ),
    ...singles(
        {
            category: 'year_earlier',
            today: JAN,
            book: 'personal',
            nature: A,
            expected: { period: { month: 'current' }, compareWith: 'year_earlier' },
        },
        [['en', 'expenses this month YoY']]
    ),
    ...singles(
        {
            category: 'year_earlier',
            today: LEAP,
            book: 'personal',
            nature: A,
            expected: { period: { month: 'current' }, compareWith: 'year_earlier' },
        },
        [['en', 'expenses this month vs the same month last year']]
    ),
    ...group(
        'january-2016-yoy',
        {
            category: 'year_earlier',
            today: NOV,
            book: 'nimbus',
            nature: A,
            expected: { period: { year: 2016, month: 1 }, compareWith: 'year_earlier' },
        },
        [
            ['en', 'revenue in January 2016 compared to January 2015'],
            ['ja', '2016年1月の収入を前年同月と比較'],
            ['zh-CN', '2016年1月收入同比'],
        ]
    ),
    ...singles(
        {
            category: 'year_earlier',
            today: NOV,
            book: 'nimbus',
            nature: A,
            expected: { period: { year: 2017, month: 3 }, compareWith: 'year_earlier' },
        },
        [['pt', 'receitas de março de 2017 comparadas com março de 2016']]
    ),
    ...singles(
        {
            category: 'year_earlier',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2019, quarter: 2 }, compareWith: 'year_earlier' },
        },
        [
            ['en', 'expenses Q2 2019 vs Q2 2018'],
            ['hi', '2019 की दूसरी तिमाही बनाम 2018 की दूसरी तिमाही के खर्च'],
        ]
    ),
];

const namedComparison: PeriodCase[] = [
    ...group(
        'last-year-vs-2023',
        {
            category: 'named_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 'previous' }, compared: { year: 2023 } },
        },
        [
            ['en', 'total income last year compared to 2023'],
            ['en', 'revenue last year vs 2023'],
            ['en', 'revenue 2025 vs 2023'],
            ['pt', 'receitas do ano passado comparadas com 2023'],
            ['es', 'ingresos del año pasado frente a 2023'],
            ['de', 'Einnahmen letztes Jahr im Vergleich zu 2023'],
            ['ja', '昨年と2023年の収入比較'],
            ['ar', 'الإيرادات العام الماضي مقارنة بعام ٢٠٢٣'],
            ['ja', '昨年と２０２３年の収入比較'],
        ]
    ),
    ...group(
        'q3-vs-q1',
        {
            category: 'named_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { quarter: 3 }, compared: { quarter: 1 } },
        },
        [
            ['en', 'expenses Q3 vs Q1'],
            ['en', 'Q3 vs Q1 expenses'],
            ['en', 'expenses third quarter compared to first quarter'],
            ['pt', 'despesas do 3º trimestre contra o 1º trimestre'],
            ['es', 'gastos T3 frente a T1'],
            ['de', 'Ausgaben Q3 gegenüber Q1'],
            ['fr', 'dépenses T3 vs T1'],
            ['ja', '第3四半期と第1四半期の支出比較'],
        ]
    ),
    ...group(
        'year-2016-vs-2014',
        {
            category: 'named_comparison',
            today: NOV,
            book: 'nimbus',
            nature: A,
            expected: { period: { year: 2016 }, compared: { year: 2014 } },
        },
        [
            ['en', 'expenses 2016 vs 2014'],
            ['en', 'compare expenses of 2016 with 2014'],
            ['pt', 'despesas de 2016 comparadas com 2014'],
            ['es', 'gastos de 2016 contra 2014'],
            ['fr', 'dépenses 2016 par rapport à 2014'],
            ['de', 'Ausgaben 2016 vs. 2014'],
            ['it', 'spese 2016 rispetto al 2014'],
            ['zh-CN', '2016年与2014年支出对比'],
            ['he', 'הוצאות 2016 לעומת 2014'],
            ['hi', '2016 बनाम 2014 के खर्च'],
            ['ar', 'مصروفات ٢٠١٦ مقابل ٢٠١٤'],
        ]
    ),
    ...group(
        'january-vs-january-2019',
        {
            category: 'named_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { month: 1 }, compared: { year: 2019 } },
        },
        [
            ['en', 'expenses January vs January 2019'],
            ['en', 'January expenses compared with January 2019'],
            ['pt', 'despesas de janeiro contra janeiro de 2019'],
            ['es', 'gastos de enero frente a enero de 2019'],
        ]
    ),
    ...group(
        'this-quarter-vs-q1',
        {
            category: 'named_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { quarter: 'current' }, compared: { quarter: 1 } },
        },
        [
            ['en', 'expenses this quarter vs Q1'],
            ['en', "this quarter's expenses compared to the first quarter"],
            ['pt', 'despesas deste trimestre contra o primeiro trimestre'],
        ]
    ),
    ...group(
        'march-2025-vs-march-2024',
        {
            category: 'named_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2025, month: 3 }, compared: { year: 2024 } },
        },
        [
            ['en', 'expenses March 2025 vs March 2024'],
            ['en', 'March 2025 compared to March 2024 expenses'],
            ['en', 'expenses March 2025 vs 2024'],
            ['pt', 'despesas de março de 2025 vs março de 2024'],
            ['fr', 'dépenses mars 2025 par rapport à mars 2024'],
            ['de', 'Ausgaben März 2025 vs. März 2024'],
            ['ja', '2025年3月と2024年3月の支出'],
        ]
    ),
    ...group(
        'year-2024-vs-2022',
        {
            category: 'named_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2024 }, compared: { year: 2022 } },
        },
        [
            ['en', 'revenue 2024 vs 2022'],
            ['pt', 'receitas de 2024 comparadas com 2022'],
            ['es', 'ingresos 2024 frente a 2022'],
            ['zh-CN', '2024年与2022年收入对比'],
        ]
    ),
    ...group(
        'january-2016-vs-december-2015',
        {
            category: 'named_comparison',
            today: NOV,
            book: 'nimbus',
            nature: A,
            expected: { period: { year: 2016, month: 1 }, compared: { year: 2015, month: 12 } },
        },
        [
            ['en', 'revenue in January 2016 compared to December 2015'],
            ['pt', 'receitas de janeiro de 2016 contra dezembro de 2015'],
        ]
    ),
    ...singles(
        {
            category: 'named_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2025, quarter: 4 }, compared: { year: 2025, quarter: 2 } },
        },
        [['en', 'expenses Q4 2025 vs Q2 2025']]
    ),
    ...group(
        'june-2019-vs-march-2019',
        {
            category: 'named_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2019, month: 6 }, compared: { year: 2019, month: 3 } },
        },
        [
            ['en', 'expenses June 2019 vs March 2019'],
            ['pt', 'gastos de junho de 2019 contra março de 2019'],
            ['it', 'spese di giugno 2019 rispetto a marzo 2019'],
        ]
    ),
    ...singles(
        {
            category: 'named_comparison',
            today: NOV,
            book: 'nimbus',
            nature: A,
            expected: { period: { year: 2018 }, compared: { year: 2012 } },
        },
        [
            ['en', 'expenses 2018 vs 2012'],
            ['ko', '2018년과 2012년 지출 비교'],
        ]
    ),
    ...group(
        'january-vs-december-mar',
        {
            category: 'named_comparison',
            today: MAR,
            book: 'personal',
            nature: A,
            expected: { period: { month: 1 }, compared: { month: 12 } },
        },
        [
            ['en', 'expenses January vs December'],
            ['pt', 'despesas de janeiro contra dezembro'],
        ]
    ),
    ...singles(
        {
            category: 'named_comparison',
            today: DEC,
            book: 'personal',
            nature: A,
            expected: { period: { quarter: 4 }, compared: { quarter: 2 } },
        },
        [['en', 'expenses Q4 vs Q2']]
    ),
    ...singles(
        {
            category: 'named_comparison',
            today: LEAP,
            book: 'personal',
            nature: A,
            expected: { period: { month: 2 }, compared: { year: 2024 } },
        },
        [['en', 'expenses February vs February 2024']]
    ),
];

const mixedComparison: PeriodCase[] = [
    ...group(
        'this-year-vs-2023',
        {
            category: 'mixed_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 'current' }, compared: { year: 2023 } },
        },
        [
            ['en', 'expenses this year vs 2023'],
            ['en', "this year's expenses compared with 2023"],
            ['pt', 'despesas deste ano contra 2023'],
            ['es', 'gastos de este año frente a 2023'],
            ['de', 'Ausgaben dieses Jahr gegenüber 2023'],
            ['ja', '今年と2023年の支出比較'],
            ['ar', 'مصروفات هذا العام مقابل 2023'],
        ]
    ),
    ...group(
        'last-month-vs-2024',
        {
            category: 'mixed_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { month: 'previous' }, compared: { year: 2024 } },
        },
        [
            ['en', 'expenses last month vs the same month in 2024'],
            ['en', "last month's expenses compared with October 2024"],
            ['pt', 'despesas do mês passado contra o mesmo mês de 2024'],
            ['es', 'gastos del mes pasado frente al mismo mes de 2024'],
        ]
    ),
    ...group(
        'last-month-vs-2024-jan',
        {
            category: 'mixed_comparison',
            today: JAN,
            book: 'personal',
            nature: A,
            expected: { period: { month: 'previous' }, compared: { year: 2024 } },
        },
        [
            ['en', 'expenses last month vs the same month in 2024'],
            ['en', 'expenses last month compared with December 2024'],
        ]
    ),
    ...group(
        'last-year-vs-2020',
        {
            category: 'mixed_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 'previous' }, compared: { year: 2020 } },
        },
        [
            ['en', 'revenue last year vs 2020'],
            ['fr', "revenus de l'année dernière par rapport à 2020"],
        ]
    ),
    ...group(
        'this-quarter-vs-q4-2024',
        {
            category: 'mixed_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { quarter: 'current' }, compared: { year: 2024 } },
        },
        [
            ['en', 'expenses this quarter vs Q4 2024'],
            ['de', 'Ausgaben dieses Quartal im Vergleich zu Q4 2024'],
        ]
    ),
    ...group(
        'ytd-vs-2024',
        {
            category: 'mixed_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { span: 'year_to_date' }, compared: { year: 2024 } },
        },
        [
            ['en', 'YTD expenses vs 2024'],
            ['pt', 'despesas acumuladas do ano contra 2024'],
        ]
    ),
    ...singles(
        {
            category: 'mixed_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2026 }, compared: { year: 'previous' } },
        },
        [
            ['en', 'expenses 2026 vs last year'],
            ['pt', 'despesas de 2026 contra o ano passado'],
        ]
    ),
    ...singles(
        {
            category: 'mixed_comparison',
            today: MAR,
            book: 'personal',
            nature: A,
            expected: { period: { month: 'current' }, compared: { year: 2025, month: 12 } },
        },
        [['en', 'expenses this month vs December 2025']]
    ),
];

const balance: PeriodCase[] = [
    ...group(
        'balance-now',
        { category: 'balance', today: NOV, book: 'personal', nature: P, expected: NOW },
        [
            ['en', 'bank balance now'],
            ['en', 'current bank balance'],
            ['en', 'how much cash do we have today'],
            ['en', 'cash balance as of today'],
            ['pt', 'saldo bancário hoje'],
            ['es', 'saldo en el banco hoy'],
            ['fr', "solde bancaire aujourd'hui"],
            ['de', 'Kontostand heute'],
            ['it', 'saldo bancario oggi'],
            ['ja', '今日の銀行残高'],
            ['zh-CN', '今天的银行余额'],
            ['ar', 'رصيد البنك اليوم'],
            ['he', 'יתרת הבנק היום'],
            ['hi', 'आज का बैंक बैलेंस'],
        ]
    ),
    ...group(
        'balance-end-2023',
        { category: 'balance', today: NOV, book: 'personal', nature: P, expected: endOfYear(2023) },
        [
            ['en', 'bank balance at the end of 2023'],
            ['en', 'cash at year-end 2023'],
            ['en', 'balance on December 31, 2023'],
            ['pt', 'saldo bancário no fim de 2023'],
            ['es', 'saldo bancario a finales de 2023'],
            ['de', 'Kontostand Ende 2023'],
            ['ja', '2023年末の銀行残高'],
            ['ar', 'رصيد البنك في نهاية ٢٠٢٣'],
        ]
    ),
    ...group(
        'balance-end-last-month',
        {
            category: 'balance',
            today: NOV,
            book: 'personal',
            nature: P,
            expected: { period: { month: 'previous' } },
        },
        [
            ['en', 'bank balance at the end of last month'],
            ['pt', 'saldo no final do mês passado'],
            ['es', 'saldo al cierre del mes pasado'],
            ['de', 'Kontostand Ende letzten Monats'],
            ['zh-CN', '上月末的银行余额'],
        ]
    ),
    ...group(
        'balance-end-last-year',
        {
            category: 'balance',
            today: NOV,
            book: 'personal',
            nature: P,
            expected: endOfYear('previous'),
        },
        [
            ['en', 'bank balance at the end of last year'],
            ['pt', 'saldo no fim do ano passado'],
            ['fr', "solde à la fin de l'année dernière"],
            ['he', 'יתרת הבנק בסוף השנה שעברה'],
        ]
    ),
    ...group(
        'balance-end-q3',
        {
            category: 'balance',
            today: NOV,
            book: 'personal',
            nature: P,
            expected: [{ period: { quarter: 3 } }, { period: { month: 9 } }],
        },
        [
            ['en', 'bank balance at the end of Q3'],
            ['it', 'saldo bancario alla fine del terzo trimestre'],
        ]
    ),
    ...group(
        'balance-now-vs-year-ago',
        {
            category: 'balance',
            today: NOV,
            book: 'personal',
            nature: P,
            expected: { period: { span: 'now' }, compareWith: 'year_earlier' },
        },
        [
            ['en', 'bank balance now vs a year ago'],
            ['en', 'cash today compared to the same time last year'],
            ['pt', 'saldo hoje comparado com um ano atrás'],
            ['es', 'saldo actual frente a hace un año'],
        ]
    ),
    ...group(
        'balance-2023-vs-2022',
        {
            category: 'balance',
            today: NOV,
            book: 'personal',
            nature: P,
            expected: { period: { year: 2023 }, compared: { year: 2022 } },
        },
        [
            ['en', 'bank balance at the end of 2023 vs the end of 2022'],
            ['pt', 'saldo no fim de 2023 contra o fim de 2022'],
        ]
    ),
    ...group(
        'debt-now',
        { category: 'balance', today: NOV, book: 'personal', nature: P, expected: NOW },
        [
            ['en', 'credit card debt today'],
            ['en', 'how much do I owe right now'],
            ['pt', 'dívida do cartão de crédito hoje'],
        ]
    ),
    ...group(
        'balance-end-last-month-jan',
        {
            category: 'balance',
            today: JAN,
            book: 'personal',
            nature: P,
            expected: { period: { month: 'previous' } },
        },
        [
            ['en', 'bank balance at the end of last month'],
            ['de', 'Kontostand Ende letzten Monats'],
        ]
    ),
    ...singles({ category: 'balance', today: DEC, book: 'personal', nature: P, expected: NOW }, [
        ['en', 'bank balance today'],
        ['ja', '今日の銀行残高'],
    ]),
    ...singles(
        {
            category: 'balance',
            today: MAR,
            book: 'personal',
            nature: P,
            expected: { period: { quarter: 'previous' } },
        },
        [['en', 'bank balance at the end of last quarter']]
    ),
    ...singles({ category: 'balance', today: LEAP, book: 'personal', nature: P, expected: NOW }, [
        ['en', 'bank balance today'],
    ]),
    ...group(
        'balance-end-march-2025',
        {
            category: 'balance',
            today: NOV,
            book: 'personal',
            nature: P,
            expected: { period: { year: 2025, month: 3 } },
        },
        [
            ['en', 'bank balance at the end of March 2025'],
            ['fr', 'solde bancaire fin mars 2025'],
        ]
    ),
    ...group(
        'saldo-hsbc-2016',
        { category: 'balance', today: NOV, book: 'nimbus', nature: P, expected: endOfYear(2016) },
        [
            ['pt', 'saldo do HSBC no fim de 2016'],
            ['en', 'HSBC balance at the end of 2016'],
        ]
    ),
];

const future: PeriodCase[] = [
    ...singles(
        {
            category: 'future',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2027 } },
        },
        [
            ['en', 'expenses in 2027'],
            ['en', 'expenses next year'],
            ['pt', 'despesas de 2027'],
            ['es', 'gastos del próximo año'],
            ['ja', '来年の支出'],
            ['hi', 'अगले साल के खर्च'],
        ]
    ),
    ...singles(
        {
            category: 'future',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2026, month: 12 } },
        },
        [
            ['en', 'expenses next month'],
            ['en', 'expenses in December 2026'],
            ['de', 'Ausgaben im nächsten Monat'],
        ]
    ),
    ...singles(
        {
            category: 'future',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2027, quarter: 1 } },
        },
        [
            ['en', 'expenses Q1 2027'],
            ['en', 'revenue next quarter'],
        ]
    ),
    ...singles(
        {
            category: 'future',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2030 } },
        },
        [['fr', 'dépenses de 2030']]
    ),
    ...singles(
        {
            category: 'future',
            today: DEC,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2027, month: 1 } },
        },
        [['en', 'expenses next month']]
    ),
    ...singles(
        {
            category: 'future',
            today: DEC,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2027 } },
        },
        [['en', 'expenses in 2027']]
    ),
    ...singles(
        {
            category: 'future',
            today: JAN,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2026, month: 2 } },
        },
        [['en', 'expenses in February 2026']]
    ),
    ...singles(
        {
            category: 'future',
            today: JAN,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2026, quarter: 2 } },
        },
        [['en', 'expenses in Q2 2026']]
    ),
    ...singles(
        {
            category: 'future',
            today: MAR,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2026, month: 4 } },
        },
        [['en', 'expenses in April 2026']]
    ),
    ...singles(
        {
            category: 'future',
            today: LEAP,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2028, month: 3 } },
        },
        [['en', 'expenses in March 2028']]
    ),
];

const invalidComparison: PeriodCase[] = [
    ...singles(
        {
            category: 'invalid_comparison',
            today: NOV,
            book: 'nimbus',
            nature: A,
            expected: { period: { year: 2016 }, compared: { year: 2018 } },
        },
        [
            ['en', 'expenses 2016 vs 2018'],
            ['pt', 'despesas de 2016 contra 2018'],
        ]
    ),
    ...singles(
        {
            category: 'invalid_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2024 }, compared: { year: 2025 } },
        },
        [
            ['en', 'revenue 2024 vs 2025'],
            ['es', 'ingresos 2024 frente a 2025'],
        ]
    ),
    ...singles(
        {
            category: 'invalid_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 'previous' }, compared: { year: 'current' } },
        },
        [['en', 'expenses last year compared with this year']]
    ),
    ...singles(
        {
            category: 'invalid_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2025, month: 3 }, compared: { year: 2025, month: 4 } },
        },
        [['en', 'expenses March 2025 vs April 2025']]
    ),
    ...singles(
        {
            category: 'invalid_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 'previous' }, compared: { month: 1 } },
        },
        [
            ['en', 'expenses last year vs January'],
            ['de', 'Ausgaben letztes Jahr im Vergleich zum Januar'],
        ]
    ),
    ...singles(
        {
            category: 'invalid_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2024 }, compared: { year: 2023, quarter: 1 } },
        },
        [
            ['en', 'expenses 2024 vs Q1 2023'],
            ['pt', 'despesas de 2024 contra o primeiro trimestre de 2023'],
        ]
    ),
    ...singles(
        {
            category: 'invalid_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2025, quarter: 3 }, compared: { year: 2025, month: 3 } },
        },
        [['en', 'expenses Q3 2025 vs March 2025']]
    ),
    ...singles(
        {
            category: 'invalid_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { year: 2025 }, compared: { year: 2024, month: 3 } },
        },
        [['fr', 'dépenses 2025 par rapport à mars 2024']]
    ),
    ...singles(
        {
            category: 'invalid_comparison',
            today: NOV,
            book: 'personal',
            nature: A,
            expected: { period: { span: 'all_time' }, compared: { year: 'previous' } },
        },
        [['en', 'expenses all time vs last year']]
    ),
];

const noPeriod: PeriodCase[] = [
    ...singles({ category: 'no_period', today: NOV, book: 'personal', nature: A, expected: NONE }, [
        ['en', 'expenses by category'],
        ['en', 'show me expenses'],
        ['en', 'how much do we spend on food?'],
        ['en', 'revenue by month'],
        ['en', 'monthly spending'],
        ['pt', 'despesas por categoria'],
        ['es', 'gastos por categoría'],
        ['fr', 'répartition des dépenses'],
        ['de', 'Ausgaben nach Kategorie'],
        ['it', 'spese per categoria'],
        ['ja', 'カテゴリ別の支出'],
        ['zh-CN', '按类别的支出'],
        ['ar', 'المصروفات حسب الفئة'],
        ['he', 'הוצאות לפי קטגוריה'],
        ['hi', 'श्रेणी के अनुसार खर्च'],
    ]),
    ...singles({ category: 'no_period', today: NOV, book: 'nimbus', nature: A, expected: NONE }, [
        ['pt', 'evolução das receitas'],
        ['pt', 'maiores despesas'],
    ]),
    ...singles({ category: 'no_period', today: JAN, book: 'personal', nature: A, expected: NONE }, [
        ['en', 'where does my money go?'],
    ]),
    ...singles(
        { category: 'no_period', today: LEAP, book: 'personal', nature: A, expected: NONE },
        [['en', 'income breakdown']]
    ),
    ...singles(
        { category: 'no_period', today: NOV, book: 'personal', nature: P, expected: [NONE, NOW] },
        [
            ['en', 'bank balance'],
            ['en', 'how much cash do we have'],
            ['en', 'credit card debt'],
            ['de', 'Kontostand meiner Bankkonten'],
            ['ja', '銀行残高'],
        ]
    ),
    ...singles(
        { category: 'no_period', today: NOV, book: 'nimbus', nature: P, expected: [NONE, NOW] },
        [['pt', 'saldo do HSBC']]
    ),
];

export const CASES: readonly PeriodCase[] = [
    ...named,
    ...relative,
    ...running,
    ...noYear,
    ...defaultComparison,
    ...yearEarlier,
    ...namedComparison,
    ...mixedComparison,
    ...balance,
    ...future,
    ...invalidComparison,
    ...noPeriod,
];

/** A case's identity across runs: its today and its request. */
export function caseKey(test: Pick<PeriodCase, 'today' | 'prompt'>): string {
    return `${test.today} ${test.prompt}`;
}

/** The readings a case accepts. */
export function expectations(test: PeriodCase): readonly PeriodRequest[] {
    return isList(test.expected) ? test.expected : [test.expected];
}

function isList(expected: Expected): expected is readonly PeriodRequest[] {
    return Array.isArray(expected);
}
