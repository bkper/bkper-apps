/**
 * Builds the report specs the renderer's gallery (`client/dev/report.html`) and component tests
 * read, with the app's own report and spec builders, from recorded Book snapshots.
 *
 *     npx tsx scripts/generate-report-specs.ts               # committed specs
 *     npx tsx scripts/generate-report-specs.ts <bookId> ...  # live Books, kept local
 *
 * Without arguments it writes `client/dev/specs/<book>.json` from the made-up Books shaped like
 * recorded Bkper payloads: the studio (`scripts/fixtures/studio-book.ts`) and the server test
 * Book. With Book ids it reads their snapshots read-only with your `bkper auth token` and writes
 * the specs to `client/dev/specs/local/`, which Git ignores, so real Book data is never
 * committed. Every spec covers a chart kind, a nature or a language the renderer must handle.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bkper } from 'bkper-js';
import type { ReportSpec } from 'report-shared/catalog';
import { addAllLocales } from 'report-shared/locales';
import { buildReport } from '../server/src/services/report.ts';
import { NET_RESULT_ROOT, type ReportIntent } from '../server/src/services/report-intent.ts';
import { buildReportSpec } from '../server/src/services/report-spec.ts';
import type { Snapshot } from '../server/src/services/snapshot.ts';
import { loadSnapshot, type SnapshotStore } from '../server/src/services/snapshot-loader.ts';
import { buildSuggestions } from '../server/src/services/suggestions.ts';
import { ServerTiming } from '../server/src/services/timing.ts';
import { fixtureSnapshot } from '../server/test/fixtures/snapshot-book.ts';
import { studioSnapshot } from './fixtures/studio-book.ts';

const SPECS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../client/dev/specs');

interface Case {
    id: string;
    intent: ReportIntent;
    lang: string;
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
        intent: intent('g-expenses', '2025', { view: 'breakdown' }),
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
        intent: intent('g-expenses', '2025-11', { view: 'breakdown' }),
        lang: 'ar-EG',
    },
    {
        id: 'revenue-total',
        intent: intent('g-revenue', 'last_month', { view: 'total' }),
        lang: 'en',
    },
];

const LEDGER_CASES: Case[] = [
    { id: 'mixed-group', intent: intent('g-net', 'last_month', { view: 'breakdown' }), lang: 'en' },
    { id: 'expenses-other-row', intent: intent('g-expenses', 'last_month'), lang: 'en' },
    { id: 'assets-today-pt', intent: intent('g-assets', 'today'), lang: 'pt-BR' },
    {
        id: 'net-result-last-12-months-ar',
        intent: intent(NET_RESULT_ROOT, 'last_12_months', { monthly: true }),
        lang: 'ar',
    },
    { id: 'card-empty', intent: intent('g-card', 'last_year'), lang: 'en' },
    { id: 'expenses-this-year-he', intent: intent('g-expenses', 'this_year'), lang: 'he' },
];

function entries(snapshot: Snapshot, cases: Case[]): GalleryEntry[] {
    return cases.flatMap(({ id, intent, lang }) => {
        const step = buildReport(intent, snapshot);
        if (!('report' in step)) {
            console.warn(`Skipped ${id}: needs the live query ${step.liveQuery.query}`);
            return [];
        }
        return [{ id, intent, lang, spec: buildReportSpec(step.report, lang) }];
    });
}

/** Suggested reports, and a breakdown of each root in the last year with data. */
function liveCases(snapshot: Snapshot): Case[] {
    const suggested = buildSuggestions(snapshot, 'en').map((suggestion, index) => ({
        id: `suggestion-${index + 1}`,
        intent: suggestion.intent,
        lang: 'en',
    }));
    const year = snapshot.dataRange?.lastMonth.slice(0, 4);
    const breakdowns = year
        ? snapshot.roots.map(root => ({
              id: `breakdown-${root}`,
              intent: intent(root, year, { view: 'breakdown' }),
              lang: 'en',
          }))
        : [];
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
        await write(join(SPECS_DIR, 'studio.json'), entries(await studioSnapshot(), STUDIO_CASES));
        await write(join(SPECS_DIR, 'ledger.json'), entries(await fixtureSnapshot(), LEDGER_CASES));
        return;
    }
    const token = execFileSync('bkper', ['auth', 'token'], { encoding: 'utf8' }).trim();
    const bkper = new Bkper({ oauthTokenProvider: async () => token });
    for (const bookId of bookIds) {
        const snapshot = await loadSnapshot(bookId, {
            bkper,
            kv: new MemoryStore(),
            timing: new ServerTiming(),
        });
        await write(
            join(SPECS_DIR, 'local', `${bookId}.json`),
            entries(snapshot, liveCases(snapshot))
        );
    }
}

await main();
