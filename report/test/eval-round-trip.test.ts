import { describe, expect, it } from 'vitest';
import type { ReportIntent } from '../server/src/services/report-intent.ts';
import { differences, identityOf } from '../scripts/eval-round-trip/identity.ts';

const TODAY = '2026-11-10';

function result(intent: ReportIntent, query: string, language = 'en') {
    return identityOf({ intent, query, language }, TODAY, 'activity');
}

describe('round trip identity', () => {
    const thisYear: ReportIntent = {
        root: 'g-expenses',
        period: { span: 'year', year: 'current' },
        monthly: false,
    };
    const query = "group:'Expenses' after:$y before:$m+1 by:m";

    it('is the same report when it reads the same months, written otherwise', () => {
        const written = result(
            { ...thisYear, root: 'net-result', period: { span: 'year', year: 2026 } },
            "group:'Expenses' after:2026 before:2026-12 by:m"
        );
        expect(differences(result(thisYear, query), written)).toEqual([]);
    });

    it('names each part a report read back differs in', () => {
        const back = result(
            { ...thisYear, period: { span: 'month', month: 'current' }, monthly: true },
            "(group:'Expenses' OR group:'Revenue') on:$m by:m",
            'pt'
        );
        expect(differences(result({ ...thisYear, hashtags: ['travel'] }, query), back)).toEqual([
            'subject',
            'hashtag',
            'period',
            'comparison',
            'monthly',
            'view',
            'language',
        ]);
    });

    it('reads a monthly report with no view as by month', () => {
        expect(
            differences(
                result({ ...thisYear, monthly: true }, query),
                result({ ...thisYear, monthly: true, view: 'trend' }, query)
            )
        ).toEqual([]);
    });
});
