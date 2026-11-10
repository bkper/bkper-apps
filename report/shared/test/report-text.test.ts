import { describe, expect, it } from 'vitest';
import { isolate } from '../src/bidi';
import type { ReportSpec } from '../src/catalog';
import { reportText } from '../src/report-text';

describe('report text', () => {
    it('stands for a report by the request it answers, else by its title and period', () => {
        const spec = (request?: string): ReportSpec => ({
            root: 'report',
            elements: {
                report: {
                    type: 'Report',
                    props: {
                        title: 'Expenses',
                        subtitle: `Jan${'\u2009–\u2009'}Nov 2026`,
                        locale: 'en',
                        dir: 'ltr',
                        fractionDigits: 2,
                        ...(request ? { request } : {}),
                    },
                    children: ['answer'],
                },
                answer: { type: 'Answer', props: { label: 'Expenses', amount: '1', color: 'red' } },
            },
        });
        expect(reportText(spec(`Expenses last year vs. ${isolate('2023')}`))).toBe(
            'Expenses last year vs. 2023'
        );
        expect(reportText(spec())).toBe(`Expenses Jan${'\u2009–\u2009'}Nov 2026`);
    });
});
