/**
 * Read-only check that Bkper reads the period queries the builder writes as its resolver does.
 *
 *     npx tsx scripts/verify-period-queries.ts [--day-first=<bookId>] [--month-first=<bookId>] [--year-first=<bookId>]
 *
 * For each Book date format it takes one of your Books (the flag's, else a known test Book, else
 * the first with an Incoming or Outgoing root and an Asset or Liability root, neither mixed). As
 * of the Book's today in its time zone, it builds a sample of every kind of query the builder
 * writes (`samples.ts`), reads each with `book.getBalancesReport` on such a root (activity on the
 * first, positions on the second: Bkper reads `before:$d+1 by:m` by month only for a group), and
 * compares Bkper's range, begin and end labels, periodicity and months of the balances with what
 * `resolveQueryDates` expects. Exits non-zero on any mismatch, any balances by day, or a missing
 * Book given by a flag. Uses your `bkper auth token`; never writes to a Book.
 */
import { execFileSync } from 'node:child_process';
import { Bkper, type Book } from 'bkper-js';
import { quote } from '../server/src/services/snapshot.ts';
import { todayInTimeZone } from '../server/src/services/periods.ts';
import {
    BOOK_DATE_PATTERNS,
    expectedRead,
    readMismatches,
    type BkperRead,
    type BookDatePattern,
} from './verify-period-queries/bkper-read.ts';
import { sampleQueries, type SampleQuery } from './verify-period-queries/samples.ts';

/** Known Books of each date format, tried first, by id or name. */
const PREFERRED: Record<BookDatePattern, string[]> = {
    'dd/MM/yyyy': ['agtzfmJrcGVyLWhyZHINCxIGTGVkZ2VyGNEPDA'],
    'MM/dd/yyyy': ['1.AAQ Services, Inc'],
    'yyyy/MM/dd': ['Copy from Bkper Tax Bot', 'DEMO Expense Reports'],
};

/** The flag that names the Book of each date format. */
const FLAGS: Record<string, BookDatePattern> = {
    'day-first': 'dd/MM/yyyy',
    'month-first': 'MM/dd/yyyy',
    'year-first': 'yyyy/MM/dd',
};

const CONCURRENCY = 4;

/** The names of the roots each nature is read from. */
interface Roots {
    activity: string;
    position: string;
}

/** The Book's first unmixed Incoming or Outgoing root by name, and first Asset or Liability one. */
async function rootsOf(book: Book): Promise<Roots | undefined> {
    // By name: Bkper does not keep the order of root groups stable between loads.
    const roots = (await book.getGroups())
        .filter(group => !group.getParent() && !group.isMixed())
        .sort((a, b) => (a.getName() ?? '').localeCompare(b.getName() ?? ''));
    const ofType = (...types: string[]) =>
        roots.find(group => types.includes(group.getType()))?.getName();
    const activity = ofType('INCOMING', 'OUTGOING');
    const position = ofType('ASSET', 'LIABILITY');
    return activity && position ? { activity, position } : undefined;
}

/** The Book to check for a date format, with its roots, or why there is none. */
async function findBook(
    bkper: Bkper,
    books: Book[],
    pattern: BookDatePattern,
    flag: string | undefined
): Promise<{ book: Book; roots: Roots } | string> {
    const candidates = flag
        ? books.filter(book => book.getId() === flag)
        : [
              ...PREFERRED[pattern].flatMap(key =>
                  books.filter(book => book.getId() === key || book.getName() === key)
              ),
              ...books,
          ].filter(book => book.getDatePattern() === pattern);
    if (flag && candidates.length === 0) {
        return `Book ${flag} is not among your Books`;
    }
    if (flag && candidates[0].getDatePattern() !== pattern) {
        return `Book ${flag} is ${candidates[0].getDatePattern()}, not ${pattern}`;
    }
    for (const candidate of new Set(candidates)) {
        const book = await bkper.getBook(candidate.getId(), false, true);
        const roots = await rootsOf(book);
        if (roots) {
            return { book, roots };
        }
        if (flag) {
            return `Book ${flag} has no unmixed Incoming/Outgoing and Asset/Liability roots`;
        }
    }
    return `none of your Books is ${pattern} with unmixed Incoming/Outgoing and Asset/Liability roots`;
}

interface Row {
    query: SampleQuery;
    read: BkperRead;
    mismatches: string[];
}

async function checkQuery(
    book: Book,
    pattern: BookDatePattern,
    roots: Roots,
    query: SampleQuery
): Promise<Row> {
    const group = roots[query.nature];
    const payload = (await book.getBalancesReport(`group:${quote(group)} ${query.dates}`)).payload;
    const read: BkperRead = {
        range: payload.range,
        rangeBeginLabel: payload.rangeBeginLabel,
        rangeEndLabel: payload.rangeEndLabel,
        periodicity: payload.periodicity,
        balances: payload.groupBalances?.find(balances => balances.name === group)?.balances ?? [],
    };
    return { query, read, mismatches: readMismatches(expectedRead(query.resolved), read, pattern) };
}

/** Runs `task` over `items`, `limit` at a time, keeping their order. */
async function inParallel<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
    const results: R[] = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await task(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

function printTable(rows: string[][]): void {
    const widths = rows[0].map((_, column) => Math.max(...rows.map(row => row[column].length)));
    for (const row of rows) {
        console.log(
            row
                .map((cell, column) => cell.padEnd(widths[column]))
                .join('  ')
                .trimEnd()
        );
    }
}

function monthsCell(read: BkperRead): string {
    const months = read.balances.map(
        ({ year, month }) => `${year}-${String(month).padStart(2, '0')}`
    );
    if (months.length <= 2) {
        return `${months.length} ${months.join(' ')}`.trim();
    }
    return `${months.length} ${months[0]}…${months[months.length - 1]}`;
}

async function verifyBook(book: Book, pattern: BookDatePattern, roots: Roots): Promise<number> {
    const today = todayInTimeZone(new Date(), book.getTimeZone());
    console.log(
        `\n${pattern}  ${book.getName()} (${book.getId()}), ${book.getTimeZone()}, today ${today}`
    );
    console.log(`activity on ${roots.activity}, positions on ${roots.position}\n`);
    const queries = sampleQueries(today);
    const rows = await inParallel(queries, CONCURRENCY, query =>
        checkQuery(book, pattern, roots, query)
    );
    printTable([
        ['', 'nature', 'query', 'Bkper range', 'labels', 'months', 'samples'],
        ...rows.map(({ query, read, mismatches }) => [
            mismatches.length === 0 ? 'ok' : 'FAIL',
            query.nature,
            query.dates,
            (read.range ?? '').trim(),
            `${read.rangeBeginLabel || '…'} – ${read.rangeEndLabel ?? ''}`,
            monthsCell(read),
            query.samples.length > 2
                ? `${query.samples.slice(0, 2).join(', ')} +${query.samples.length - 2}`
                : query.samples.join(', '),
        ]),
    ]);
    const failed = rows.filter(row => row.mismatches.length > 0);
    for (const { query, mismatches } of failed) {
        console.log(`\nFAIL ${query.nature} ${query.dates} (${query.samples.join(', ')})`);
        for (const mismatch of mismatches) {
            console.log(`  ${mismatch}`);
        }
    }
    console.log(`\n${rows.length - failed.length} of ${rows.length} queries read as expected.`);
    return failed.length;
}

async function main(): Promise<void> {
    const flags = new Map<BookDatePattern, string>();
    for (const arg of process.argv.slice(2)) {
        const match = /^--([a-z-]+)=(.+)$/.exec(arg);
        const pattern = match && Object.hasOwn(FLAGS, match[1]) ? FLAGS[match[1]] : undefined;
        if (!match || !pattern) {
            console.error(
                'Usage: npx tsx scripts/verify-period-queries.ts [--day-first=<bookId>] [--month-first=<bookId>] [--year-first=<bookId>]'
            );
            process.exit(2);
        }
        flags.set(pattern, match[2]);
    }
    const token = execFileSync('bkper', ['auth', 'token'], { encoding: 'utf8' }).trim();
    const bkper = new Bkper({ oauthTokenProvider: async () => token });
    const books = await bkper.getBooks();
    let failures = 0;
    const missing: string[] = [];
    for (const pattern of BOOK_DATE_PATTERNS) {
        const found = await findBook(bkper, books, pattern, flags.get(pattern));
        if (typeof found === 'string') {
            console.log(`\n${pattern}  NOT CHECKED: ${found}.`);
            missing.push(pattern);
            if (flags.has(pattern)) {
                failures++;
            }
            continue;
        }
        failures += await verifyBook(found.book, pattern, found.roots);
    }
    const checked = BOOK_DATE_PATTERNS.length - missing.length;
    console.log(
        `\n${failures === 0 ? 'PASS' : 'FAIL'}: ${checked} date format(s) checked` +
            (missing.length > 0 ? `; no Book for ${missing.join(', ')}` : '') +
            (failures > 0 ? `; ${failures} failure(s)` : '') +
            '.'
    );
    process.exit(failures === 0 ? 0 : 1);
}

await main();
