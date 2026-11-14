/**
 * Replays Bookbot's discovery on the frozen cases and scores it. Never reads a Book.
 *
 *   bun eval/discovery-books/run.ts --data <dir> --label <run> [--live] [--baseline <run>] [--books <label>,<label>]
 *
 * Without --live, Jev's answers come only from `<dir>/runs/<run>/jev.json.gz`, so the results can be
 * checked again offline for free. --live asks Jev for requests not recorded yet: paid calls.
 * Writes `<dir>/runs/<run>/results.json.gz` and `RESULTS.md`; with --baseline, RESULTS.md also
 * checks the run against the target. A run with any error is not valid for comparison.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { cliToken, mapLimit, readJsonGz, writeJsonGz, type BookConfig, type BookSnapshot, type JevAnswer } from './frozen.js';
import { installReadOnlyGuard } from './readOnly.js';
import { replayCase } from './replay.js';
import { renderReport, tally, type CaseResult } from './score.js';

const CASES_AT_A_TIME = 8;

async function main(): Promise<number> {
    const { values } = parseArgs({
        options: { data: { type: 'string' }, label: { type: 'string' }, live: { type: 'boolean' }, baseline: { type: 'string' }, books: { type: 'string' } },
    });
    if (!values.data || !values.label) throw new Error('Pass --data <dir> and --label <run>.');
    installReadOnlyGuard();
    const runDir = join(values.data, 'runs', values.label);
    await mkdir(runDir, { recursive: true });
    const recordingPath = join(runDir, 'jev.json.gz');
    const recording = new Map(Object.entries(existsSync(recordingPath) ? await readJsonGz<Record<string, JevAnswer>>(recordingPath) : {}));
    const live = values.live ? { token: cliToken() } : undefined;

    const only = values.books?.split(',');
    const configs = (JSON.parse(await readFile(join(values.data, 'books.json'), 'utf8')) as BookConfig[])
        .filter(config => !config.excluded && (!only || only.includes(config.label)));
    const results: CaseResult[] = [];
    let missing = 0;
    for (const config of configs) {
        const snapshot = await readJsonGz<BookSnapshot>(join(values.data, 'snapshot', `${config.id}.json.gz`));
        const bookResults = await mapLimit(snapshot.cases, CASES_AT_A_TIME, evalCase => replayCase(snapshot, evalCase, { recording, live }));
        for (const { missing: isMissing, ...result } of bookResults) {
            if (isMissing) missing++;
            results.push(result);
        }
        const counts = tally(bookResults);
        console.log(`${config.label}: ${counts.right} right, ${counts.wrong} wrong, ${counts.none} no guess, ${counts.errors} errors`);
        if (live) await writeJsonGz(recordingPath, Object.fromEntries(recording));
    }

    await writeJsonGz(join(runDir, 'results.json.gz'), results);
    const baseline = values.baseline
        ? { label: values.baseline, results: await readJsonGz<CaseResult[]>(join(values.data, 'runs', values.baseline, 'results.json.gz')) }
        : undefined;
    await writeFile(join(runDir, 'RESULTS.md'), renderReport(values.label, results, baseline));
    const counts = tally(results);
    console.log(`All: ${counts.right} right, ${counts.wrong} wrong, ${counts.none} no guess, ${counts.errors} errors. Wrote ${join(runDir, 'RESULTS.md')}`);
    if (missing > 0) console.error(`${missing} cases need data the snapshot or recording does not hold${live ? '' : '; run with --live for Jev answers'}.`);
    return counts.errors > 0 ? 1 : 0;
}

process.exit(await main());
