/**
 * What makes two reports the same report, for the round trip of a report's text: what it is of
 * (the groups and accounts its query reads), its hashtag, the months of its period and of what
 * it compares with, whether it is by month and how it is shown, and its language. The chart is
 * left out: it is an option of the request, not what the report is.
 */
import type { IsoDate, ReportNature } from '../../server/src/services/periods.ts';
import type { ReportIntent } from '../../server/src/services/report-intent.ts';
import {
    describeMeaning,
    meaningOf,
    sameComparison,
    samePeriod,
    type Meaning,
} from '../eval-periods/score.ts';

export const IDENTITY_PARTS = [
    'subject',
    'hashtag',
    'period',
    'comparison',
    'monthly',
    'view',
    'language',
] as const;

export type IdentityPart = (typeof IDENTITY_PARTS)[number];

export interface ReportIdentity {
    /** The query's filters of groups and accounts, without its hashtag and dates. */
    subject: string;
    hashtags: string[];
    meaning: Meaning;
    monthly: boolean;
    /** How it is shown: its view, by month when it names none but is monthly. */
    view: string;
    language: string;
}

/** The report a result is, as its query, intent and language say it, at the Book's today. */
export function identityOf(
    result: { intent: ReportIntent; query: string; language: string },
    today: IsoDate,
    nature: ReportNature
): ReportIdentity {
    const { intent } = result;
    return {
        subject: result.query
            .replace(/\s+(?:on|after|before|by):\S+/g, '')
            .replace(/\s+#\S+/g, '')
            .trim(),
        hashtags: intent.hashtags ?? [],
        meaning: meaningOf({ request: intent }, today, nature),
        monthly: intent.monthly,
        view: intent.view ?? (intent.monthly ? 'trend' : 'auto'),
        language: result.language,
    };
}

/** The parts in which two reports differ; none when they are the same report. */
export function differences(a: ReportIdentity, b: ReportIdentity): IdentityPart[] {
    const same: Record<IdentityPart, boolean> = {
        subject: a.subject === b.subject,
        hashtag: a.hashtags.join(',') === b.hashtags.join(','),
        period: samePeriod(a.meaning, b.meaning),
        comparison: sameComparison(a.meaning, b.meaning),
        monthly: a.monthly === b.monthly,
        view: a.view === b.view,
        language: a.language === b.language,
    };
    return IDENTITY_PARTS.filter(part => !same[part]);
}

/** One line of a report's identity, to compare two by eye. */
export function describeIdentity(identity: ReportIdentity): string {
    const tags = identity.hashtags.map(tag => ` #${tag}`).join('');
    return (
        `${identity.subject}${tags} | ${describeMeaning(identity.meaning)}` +
        ` | ${identity.monthly ? 'monthly' : 'total'} ${identity.view} | ${identity.language}`
    );
}
