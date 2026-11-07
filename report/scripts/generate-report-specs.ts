/**
 * Builds the report specs the renderer's gallery (`client/dev/report.html`) and component tests
 * read, with the app's own report and spec builders, from Book snapshots and the balances of
 * each report's own queries.
 *
 *     npx tsx scripts/generate-report-specs.ts               # committed specs
 *     npx tsx scripts/generate-report-specs.ts <bookId> ...  # live Books, kept local
 *
 * Without arguments it writes `client/dev/specs/<book>.json` from the made-up Books shaped like
 * recorded Bkper payloads, whose fake ledgers answer balances queries as Bkper does: the studio
 * (`scripts/fixtures/studio-book.ts`) and the server test Book. With Book ids it reads their
 * snapshots and balances read-only with your `bkper auth token` and writes the specs to
 * `client/dev/specs/local/`, which Git ignores, so real Book data is never committed. Every spec
 * covers a chart kind, a nature or a language the renderer must handle.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BalancesReport, Bkper, Book } from 'bkper-js';
import type { ReportSpec } from 'report-shared/catalog';
import { addAllLocales } from 'report-shared/locales';
import { readQueryBalances, type QueryBalances } from '../server/src/services/balances.ts';
import { readReport } from '../server/src/services/default-period.ts';
import { buildReport } from '../server/src/services/report.ts';
import { NET_RESULT_ROOT, type ReportIntent } from '../server/src/services/report-intent.ts';
import { buildReportSpec } from '../server/src/services/report-spec.ts';
import type { Snapshot } from '../server/src/services/snapshot.ts';
import {
    currentUserId,
    loadSnapshot,
    type SnapshotStore,
} from '../server/src/services/snapshot-loader.ts';
import { buildSuggestions } from '../server/src/services/suggestions.ts';
import { ServerTiming } from '../server/src/services/timing.ts';
import type { FakeLedger } from '../server/test/fixtures/ledger.ts';
import {
    fixtureLedger,
    ledgerBalances,
    ledgerSnapshot,
} from '../server/test/fixtures/snapshot-book.ts';
import { STUDIO_DATA_AT, studioLedger, studioSnapshot } from './fixtures/studio-book.ts';

const SPECS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../client/dev/specs');

interface Case {
    id: string;
    intent: ReportIntent;
    lang: string;
    /** The intent's period is the default one, as for a request that names none. */
    defaultPeriod?: boolean;
}

export interface GalleryEntry {
    id: string;
    intent: ReportIntent;
    lang: string;
    spec: ReportSpec;
}

function intent(root: string, period: string, extra: Partial<ReportIntent> = {}): ReportIntent {
    return { root, period, monthly: false, ...extra };
}

const STUDIO_CASES: Case[] = [
    {
        id: 'expenses-by-month',
        intent: intent('g-expenses', '2025', { monthly: true }),
        lang: 'en',
    },
    {
        id: 'expenses-breakdown',
        intent: intent('g-expenses', '2025', { view: 'breakdown', chart: 'ranked-bar' }),
        lang: 'en',
    },
    { id: 'taxes-donut', intent: intent('g-taxes', '2025-Q4', { view: 'breakdown' }), lang: 'en' },
    {
        id: 'bank-accounts-by-month',
        intent: intent('g-bank-accounts', '2025', { monthly: true }),
        lang: 'en',
    },
    { id: 'loans-today', intent: intent('g-loans', 'today'), lang: 'en' },
    {
        id: 'net-result-by-month-pt',
        intent: intent(NET_RESULT_ROOT, '2025', { monthly: true }),
        lang: 'pt-BR',
    },
    {
        id: 'revenue-donut-ja',
        intent: intent('g-revenue', '2025', { view: 'breakdown' }),
        lang: 'ja',
    },
    {
        id: 'expenses-breakdown-ar',
        intent: intent('g-expenses', '2025-11', { view: 'breakdown', chart: 'ranked-bar' }),
        lang: 'ar-EG',
    },
    {
        id: 'revenue-total',
        intent: intent('g-revenue', 'last_month', { view: 'total' }),
        lang: 'en',
    },
    { id: 'revenue-pie', intent: intent('g-revenue', '2025', { chart: 'pie' }), lang: 'en' },
    {
        id: 'expenses-stacked',
        intent: intent('g-expenses', '2025', { monthly: true, chart: 'stacked' }),
        lang: 'en',
    },
    {
        id: 'expenses-stacked-he',
        intent: intent('g-expenses', '2025', { monthly: true, chart: 'stacked' }),
        lang: 'he',
    },
    {
        id: 'bank-accounts-area',
        intent: intent('g-bank-accounts', '2025', { monthly: true, chart: 'area' }),
        lang: 'en',
    },
    {
        id: 'net-result-area-ar',
        intent: intent(NET_RESULT_ROOT, '2025', { monthly: true, chart: 'area' }),
        lang: 'ar',
    },
    {
        id: 'expenses-compare',
        intent: intent('g-expenses', '2025', { chart: 'compare' }),
        lang: 'en',
    },
    {
        id: 'bank-accounts-compare-ar',
        intent: intent('g-bank-accounts', '2025', { chart: 'compare' }),
        lang: 'ar-EG',
    },
    {
        id: 'net-result-compare',
        intent: intent(NET_RESULT_ROOT, '2025', { chart: 'compare' }),
        lang: 'en',
    },
    {
        id: 'net-result-loss-ar',
        intent: intent(NET_RESULT_ROOT, '2025-09'),
        lang: 'ar',
    },
    {
        id: 'bank-accounts-bridge-unfit',
        intent: intent('g-bank-accounts', '2025-Q3', { chart: 'waterfall' }),
        lang: 'en',
    },
    {
        id: 'expenses-table',
        intent: intent('g-expenses', '2025', { chart: 'table' }),
        lang: 'en',
    },
    {
        id: 'targets-by-month',
        intent: intent('g-expenses', '2025', {
            monthly: true,
            target: 'g-people',
            alongside: [{ root: 'g-expenses', target: 'g-office' }, { root: 'g-taxes' }],
        }),
        lang: 'en',
    },
    {
        id: 'targets-compare-ar',
        intent: intent('g-revenue', '2025', {
            chart: 'compare',
            alongside: [{ root: 'g-expenses' }],
        }),
        lang: 'ar',
    },
];

const LEDGER_CASES: Case[] = [
    { id: 'mixed-group', intent: intent('g-net', 'last_month', { view: 'breakdown' }), lang: 'en' },
    { id: 'expenses-last-month', intent: intent('g-expenses', 'last_month'), lang: 'en' },
    {
        id: 'net-result-group',
        intent: intent(NET_RESULT_ROOT, 'last_month', { chart: 'waterfall' }),
        lang: 'en',
    },
    { id: 'assets-today-pt', intent: intent('g-assets', 'today'), lang: 'pt-BR' },
    {
        id: 'net-income-last-12-months-ar',
        intent: intent(NET_RESULT_ROOT, 'last_12_months', { monthly: true }),
        lang: 'ar',
    },
    { id: 'card-empty', intent: intent('g-card', 'last_year'), lang: 'en' },
    {
        id: 'banks-target-today',
        intent: intent('g-assets', 'today', { target: 'g-banks' }),
        lang: 'en',
    },
    {
        id: 'rent-account-by-month',
        intent: intent('g-expenses', 'this_year', { monthly: true, target: 'a-rent' }),
        lang: 'en',
    },
    { id: 'expenses-this-year-he', intent: intent('g-expenses', 'this_year'), lang: 'he' },
    {
        id: 'mixed-pie-fallback',
        intent: intent('g-net', 'last_month', { chart: 'pie' }),
        lang: 'en',
    },
    {
        id: 'mixed-compare',
        intent: intent('g-net', 'last_month', { chart: 'compare' }),
        lang: 'en',
    },
    {
        id: 'targets-pie-unfit',
        intent: intent('g-expenses', 'last_month', {
            target: 'a-food',
            alongside: [{ root: 'g-expenses', target: 'a-rent' }],
            chart: 'pie',
        }),
        lang: 'en',
    },
    {
        id: 'expenses-pie-negative',
        intent: intent('g-expenses', 'last_month', { chart: 'pie' }),
        lang: 'en',
    },
];

/** Reads the balances of each query, as the Worker does. */
type BalancesReader = (queries: string[]) => Promise<QueryBalances[]>;

async function entries(
    snapshot: Snapshot,
    cases: Case[],
    read: BalancesReader
): Promise<GalleryEntry[]> {
    const built: GalleryEntry[] = [];
    for (const { id, lang, ...asked } of cases) {
        const { intent, balances } = await readReport(asked.intent, snapshot, {
            loadBalances: read,
            defaultPeriod: asked.defaultPeriod,
        });
        const report = buildReport(intent, snapshot, balances);
        built.push({ id, intent, lang, spec: buildReportSpec(report, lang) });
    }
    return built;
}

function ledgerReader(ledger: FakeLedger, dataAt?: Date): BalancesReader {
    return async queries => queries.map(query => ledgerBalances(ledger, query, dataAt));
}

/**
 * Suggested reports, and a breakdown of each root in its default period: this year (or its
 * last year with movements) for activity, today for a position.
 */
function liveCases(snapshot: Snapshot): Case[] {
    const suggested = buildSuggestions(snapshot, 'en').map((suggestion, index) => ({
        id: `suggestion-${index + 1}`,
        intent: suggestion.intent,
        lang: 'en',
    }));
    const breakdowns = snapshot.roots.map(root => ({
        id: `breakdown-${root}`,
        intent: intent(root, snapshot.groups[root].permanent ? 'today' : 'this_year', {
            view: 'breakdown',
        }),
        lang: 'en',
        defaultPeriod: true,
    }));
    return [...suggested, ...breakdowns];
}

async function write(path: string, value: GalleryEntry[]): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(value, null, 4)}\n`);
    console.log(`Wrote ${value.length} specs to ${path}`);
}

class MemoryStore implements SnapshotStore {
    private readonly values = new Map<string, string>();
    async get(key: string) {
        return this.values.get(key) ?? null;
    }
    async put(key: string, value: string) {
        this.values.set(key, value);
    }
}

async function main(): Promise<void> {
    // Specs are written in their languages, as the Worker writes them.
    addAllLocales();
    const bookIds = process.argv.slice(2);
    if (bookIds.length === 0) {
        const studio = studioLedger();
        const ledger = fixtureLedger();
        // A refund larger than October's food, so Food shows below zero then, as Bkper shows it.
        ledger.transactions.push({
            date: '2026-10-20',
            from: 'Food',
            to: 'Bank A',
            amount: '387.24',
        });
        await write(
            join(SPECS_DIR, 'studio.json'),
            await entries(
                await studioSnapshot(studio),
                STUDIO_CASES,
                ledgerReader(studio, STUDIO_DATA_AT)
            )
        );
        await write(
            join(SPECS_DIR, 'ledger.json'),
            await entries(await ledgerSnapshot(ledger), LEDGER_CASES, ledgerReader(ledger))
        );
        return;
    }
    const token = execFileSync('bkper', ['auth', 'token'], { encoding: 'utf8' }).trim();
    const bkper = new Bkper({ oauthTokenProvider: async () => token });
    const timing = new ServerTiming();
    const userId = await currentUserId(bkper, timing);
    for (const bookId of bookIds) {
        const snapshot = await loadSnapshot(bookId, {
            userId,
            bkper,
            kv: new MemoryStore(),
            timing,
        });
        const book = new Book({ id: bookId }, bkper.getConfig());
        const read: BalancesReader = queries =>
            Promise.all(
                queries.map(async query => {
                    const asked = new Date();
                    return readQueryBalances(query, await book.getBalancesReport(query), asked);
                })
            );
        await write(
            join(SPECS_DIR, 'local', `${bookId}.json`),
            await entries(snapshot, liveCases(snapshot), read)
        );
    }
}

await main();
