import { isolate, withoutIsolates } from 'report-shared/bidi';
import { addAllLocales } from 'report-shared/locales';
import type { PeriodRequest } from 'report-shared/report-intent';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractHashtags } from '../../src/services/intent-resolver';
import { findPromptNames } from '../../src/services/prompt-names';
import { periodTexts, requestText } from '../../src/services/request-text';
import { periodCombinations } from '../fixtures/period-combinations';
import { fixtureSnapshot } from '../fixtures/snapshot-book';

const LANGUAGES = ['en', 'pt', 'es', 'ja', 'ar'];
const COMBINATIONS = periodCombinations('2026-11-09');

function plain(text: string): string {
    return withoutIsolates(text).trim();
}

/** The words of a text, as the language segments them. */
function words(text: string, segmenter: Intl.Segmenter, lang: string): string[] {
    return [...segmenter.segment(text)]
        .filter(segment => segment.isWordLike)
        .map(segment => segment.segment.toLocaleLowerCase(lang));
}

/** A run of words written twice in a row, such as "year year" or "this year this year". */
function repeatedPhrase(list: readonly string[]): string | undefined {
    for (let length = 1; length <= list.length / 2; length++) {
        for (let start = 0; start + 2 * length <= list.length; start++) {
            const first = list.slice(start, start + length).join(' ');
            if (first === list.slice(start + length, start + 2 * length).join(' ')) {
                return first;
            }
        }
    }
    return undefined;
}

describe('request text', () => {
    beforeAll(() => addAllLocales());

    it('covers every kind of period and comparison', () => {
        expect(COMBINATIONS.length).toBeGreaterThan(10_000);
        expect(COMBINATIONS.some(request => request.compared)).toBe(true);
        expect(COMBINATIONS.some(request => request.compareWith === 'year_earlier')).toBe(true);
    });

    it('never writes the same words for the period and what it is compared with', () => {
        const same: string[] = [];
        for (const lang of LANGUAGES) {
            for (const request of COMBINATIONS) {
                const { period, compared } = periodTexts(request, lang);
                if (compared !== undefined && plain(compared) === plain(period)) {
                    same.push(`${lang} ${JSON.stringify(request)}: ${plain(period)}`);
                }
            }
        }
        expect(same).toEqual([]);
    }, 60_000);

    it('never writes a phrase twice in a row', () => {
        const repeated = new Set<string>();
        for (const lang of LANGUAGES) {
            const segmenter = new Intl.Segmenter(lang, { granularity: 'word' });
            const texts = new Set(
                COMBINATIONS.map(request => plain(requestText(request, 'Despesas', lang)))
            );
            for (const text of texts) {
                if (repeatedPhrase(words(text, segmenter, lang)) !== undefined) {
                    repeated.add(`${lang} ${text}`);
                }
            }
        }
        expect([...repeated]).toEqual([]);
    }, 60_000);

    it('adds no words for this year where the period already means it', () => {
        const spans: PeriodRequest['period'][] = [
            { span: 'year_to_date' },
            { span: 'last_12_months' },
            { span: 'now' },
            { span: 'all_time' },
            { span: 'month', month: 'current' },
            { span: 'month', month: 'previous' },
            { span: 'quarter', quarter: 'current' },
            { span: 'quarter', quarter: 'previous' },
        ];
        for (const lang of LANGUAGES) {
            for (const period of spans) {
                expect(periodTexts({ period: { ...period, year: 'current' } }, lang)).toEqual(
                    periodTexts({ period }, lang)
                );
            }
        }
    });

    it('writes a comparison that inherits the period’s parts relative to the period', () => {
        const texts: [PeriodRequest, string][] = [
            [
                { period: { span: 'now', year: 'current' }, compared: { year: 'previous' } },
                'Capital now vs. 1 year ago',
            ],
            [{ period: { span: 'year_to_date', year: 'current' } }, 'Capital year to date'],
            [
                { period: { span: 'month', month: 'previous' }, compared: { year: 'previous' } },
                'Capital last month vs. the same month last year',
            ],
            [
                { period: { span: 'quarter', quarter: 'current' }, compared: { year: 2023 } },
                'Capital this quarter vs. the same quarter 2023',
            ],
            [
                { period: { span: 'year_to_date' }, compared: { year: 'previous' } },
                'Capital year to date vs. the same months last year',
            ],
            [
                { period: { month: 1 }, compared: { year: 2019 } },
                'Capital January vs. January 2019',
            ],
            [
                { period: { month: 1 }, compared: { month: 1 } },
                'Capital January vs. the same period a year earlier',
            ],
            [
                { period: { span: 'year', year: 'previous' }, compared: { year: 'previous' } },
                'Capital last year',
            ],
            [
                { period: { span: 'year_to_date', year: 2023 }, compareWith: 'year_earlier' },
                'Capital year to date 2023 vs. the same months 2022',
            ],
            [
                { period: { quarter: 'previous', year: 'previous' }, compareWith: 'year_earlier' },
                'Capital last quarter last year vs. the same quarter 2 years ago',
            ],
            [
                { period: { quarter: 'current' }, compareWith: 'year_earlier' },
                'Capital this quarter vs. the same period a year earlier',
            ],
        ];
        for (const [request, text] of texts) {
            expect(plain(requestText(request, 'Capital', 'en')), JSON.stringify(request)).toBe(
                text
            );
        }
    });

    it('says a report by month and its hashtag, which a request reads back', () => {
        const thisYear: PeriodRequest = { period: { span: 'year', year: 'current' } };
        expect(
            plain(requestText({ ...thisYear, monthly: true, hashtags: ['travel'] }, 'Food', 'en'))
        ).toBe('Food by month this year #travel');
        for (const lang of LANGUAGES) {
            const monthly = plain(requestText({ ...thisYear, monthly: true }, 'Food', lang));
            expect(monthly, lang).not.toBe(plain(requestText(thisYear, 'Food', lang)));
            expect(monthly, lang).toContain('Food');
            const tagged = plain(requestText({ ...thisYear, hashtags: ['viagem'] }, 'Food', lang));
            expect(extractHashtags(tagged), lang).toEqual(['viagem']);
        }
    });

    it('writes names side by side apart from the words a list joins to them', async () => {
        const snapshot = await fixtureSnapshot();
        // Arabic and Thai join their "and" to the next word, where no name is found.
        for (const lang of [...LANGUAGES, 'th', 'zh-CN', 'he', 'hi']) {
            const title = new Intl.ListFormat(lang, { type: 'conjunction' }).format(
                ['Expenses', 'Revenue'].map(isolate)
            );
            for (const monthly of [false, true]) {
                const text = plain(requestText({ period: { span: 'now' }, monthly }, title, lang));
                expect(
                    findPromptNames(text, snapshot).map(name => name.name),
                    `${lang}: ${text}`
                ).toEqual(['Expenses', 'Revenue']);
            }
        }
    });
});
