import { supportedLanguage } from 'report-shared/languages';

/** Bkper keeps the person's language choice in this cookie, shared by every app on `*.bkper.app`. */
const LANGUAGE_COOKIE = 'bkper_language';

/**
 * The person's language: the one they chose in Bkper, else their browser's first supported
 * language, else English. As every Bkper app derives it, so Report speaks as Bkper does.
 */
export function personLanguage(cookies: string, preferences: readonly string[]): string {
    const chosen = cookieValue(cookies, LANGUAGE_COOKIE);
    const choice = chosen === undefined ? undefined : supportedLanguage(chosen);
    if (choice) return choice;
    for (const tag of preferences) {
        const language = supportedLanguage(tag);
        if (language) return language;
    }
    return 'en';
}

function cookieValue(cookies: string, name: string): string | undefined {
    for (const pair of cookies.split(';')) {
        const separator = pair.indexOf('=');
        if (separator < 0 || pair.slice(0, separator).trim() !== name) continue;
        try {
            return decodeURIComponent(pair.slice(separator + 1).trim());
        } catch {
            return undefined;
        }
    }
    return undefined;
}
