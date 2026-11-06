/**
 * What an API request says about its caller beyond its parameters: the languages it accepts
 * and the app environment it reached.
 */
import { supportedLanguage } from 'report-shared/languages';

const PRODUCTION_ORIGIN = 'https://report.bkper.app';
const PREVIEW_ORIGIN = 'https://report-preview.bkper.app';

/** The first Bkper language of an `Accept-Language` header, by preference. */
export function acceptedLanguage(header: string | undefined): string | undefined {
    return (header ?? '')
        .split(',')
        .map((part, index) => {
            const [tag, ...params] = part.trim().split(';');
            const q = params.map(param => /^\s*q=([\d.]+)\s*$/.exec(param)?.[1]).find(Boolean);
            return { tag: tag.trim(), weight: q === undefined ? 1 : Number(q), index };
        })
        .filter(entry => entry.weight > 0)
        .sort((a, b) => b.weight - a.weight || a.index - b.index)
        .map(entry => supportedLanguage(entry.tag))
        .find(language => language !== undefined);
}

/**
 * The Report app page of a request in a Book: on the preview environment when the API was
 * reached there, otherwise in production.
 */
export function reportAppUrl(requestUrl: string, bookId: string, text: string): string {
    const preview = new URL(requestUrl).origin === PREVIEW_ORIGIN;
    const url = new URL('/', preview ? PREVIEW_ORIGIN : PRODUCTION_ORIGIN);
    url.searchParams.set('book', bookId);
    url.searchParams.set('q', text);
    return url.toString();
}
