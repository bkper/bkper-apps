import type { ReportSpec } from 'report-shared/catalog';
import { LOCALES } from 'report-shared/locales';
import type { ReportFileData } from 'report-shared/report-file';
import { t, type StringKey } from 'report-shared/strings';
import { describe, expect, it } from 'vitest';
import { REPORT_FILE_BUNDLE, buildReportFile } from '../../src/services/report-file';

const LINK = {
    url: 'https://report.bkper.app/?book=book-1&q=expenses+%3C%2Fscript%3E',
    label: 'Open in Report',
};

/** The Agent shows HTML files up to 1 MB; the bundle leaves most of it to the report data. */
const MAX_BUNDLE_BYTES = 400 * 1024;

const SOURCE_URL = 'https://bkper.app/b/#transactions:bookId=book-1';

const BUNDLE = { script: 'window.started = true;', style: 'body { margin: 0; }' };

/** A spec as the server builds it, with names that try to break out of the file. */
function spec(): ReportSpec {
    return {
        root: 'report',
        elements: {
            report: {
                type: 'Report',
                props: {
                    title: 'Cash & <Bank>',
                    subtitle: '"2026"',
                    locale: 'ar',
                    dir: 'rtl',
                    fractionDigits: 2,
                },
                children: ['answer', 'source'],
            },
            answer: {
                type: 'Answer',
                props: {
                    label: 'Bank </script><script>alert(1)</script>',
                    amount: '10',
                    color: 'blue',
                },
            },
            source: {
                type: 'Source',
                props: {
                    footer: 'Line\u2028separator\u2029paragraph <!-- comment',
                    period: '2026',
                    query: "group:'Bank' before:2026-11-06",
                    url: SOURCE_URL,
                    dataAt: '2026-11-05T15:00:00.000Z',
                    labels: {
                        source: 'Source',
                        period: 'Period',
                        query: 'Query',
                        dataAt: 'Balances read',
                        open: 'Open in Bkper',
                    },
                },
                on: {
                    open: {
                        action: 'openInBkper',
                        params: { url: SOURCE_URL },
                    },
                },
            },
        },
    };
}

/** The text of the file's data script, and the data it carries. */
function dataOf(html: string): { text: string; data: ReportFileData } {
    const match = /<script type="application\/json" id="report-data">(.*?)<\/script>/s.exec(html);
    if (!match) {
        throw new Error('No report data in the file');
    }
    return { text: match[1], data: JSON.parse(match[1]) as ReportFileData };
}

describe('report file', () => {
    it('is one document in the report language, titled by the report', () => {
        const html = buildReportFile(spec(), LINK, BUNDLE);

        expect(html).toMatch(/^<!doctype html>\n<html lang="ar" dir="rtl">/);
        expect(html).toContain('<meta charset="utf-8">');
        expect(html).toContain('<title>Cash &amp; &lt;Bank&gt; · &quot;2026&quot;</title>');
        expect(html).toContain(`<style>${BUNDLE.style}</style>`);
        expect(html).toContain(`<script>${BUNDLE.script}</script>`);
        expect(html.indexOf('<report-view>')).toBeLessThan(html.indexOf('id="report-data"'));
        expect(html.indexOf('id="report-data"')).toBeLessThan(html.indexOf(BUNDLE.script));
    });

    it('carries the spec and the link without ending its script early', () => {
        const html = buildReportFile(spec(), LINK, BUNDLE);
        const { text, data } = dataOf(html);

        expect(text).not.toMatch(/<\/?script|<!--|\u2028|\u2029/i);
        expect(data.link).toEqual(LINK);
        const expected = spec();
        const source = expected.elements.source;
        if (source.type === 'Source') {
            expected.elements.source = { type: 'Source', props: source.props };
        }
        // The file cannot open Bkper in place: its Source keeps no openInBkper action.
        expect(data.spec).toEqual(expected);
    });

    it('carries a Content-Security-Policy that lets it load nothing', () => {
        const html = buildReportFile(spec(), LINK, BUNDLE);
        expect(html).toContain(
            `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'">`
        );
    });

    describe('with the built renderer bundle', () => {
        const html = buildReportFile(spec(), LINK);

        it('refers to nothing on the network but its link to the Report app', () => {
            const urls = [...html.matchAll(/https?:\/\/[^\s"'`()<>\\]+/gi)].map(match => match[0]);
            // Web Awesome names its docs in a comment it adds to each component, and the Source
            // keeps the query's Bkper URL as data, which the file shows no link to.
            expect(
                urls.filter(url => !url.startsWith('https://webawesome.com/docs/components/'))
            ).toEqual([SOURCE_URL, LINK.url]);
            expect(html).not.toMatch(
                /\b(?:src|href|action|srcset|poster)\s*=\s*["']?\s*(?:https?:)?\/\//i
            );
            expect(html).not.toMatch(/@import/i);
            expect(html).not.toMatch(/url\(\s*["']?\s*(?:https?:)?\/\//i);
            expect(html).not.toMatch(
                /\bfetch\s*\(|XMLHttpRequest|\bimport\s*\(|sendBeacon|WebSocket|EventSource|importScripts|new\s+Worker/
            );
        });

        it('carries the strings of no language: the spec has its own, resolved', () => {
            const bundle = REPORT_FILE_BUNDLE.script + REPORT_FILE_BUNDLE.style;
            const keys: StringKey[] = ['hint_not_a_report', 'error_future_period'];
            for (const key of keys) {
                for (const text of [t(key, 'en'), LOCALES.ja[key], LOCALES.pt[key]]) {
                    expect(text).toBeTruthy();
                    expect(bundle).not.toContain(text);
                }
            }
        });

        it('stays within its size bound', () => {
            const bytes = new TextEncoder().encode(
                REPORT_FILE_BUNDLE.script + REPORT_FILE_BUNDLE.style
            ).length;
            expect(bytes).toBeLessThanOrEqual(MAX_BUNDLE_BYTES);
        });
    });
});
