export interface MenuContext {
    bookId: string | null;
    query: string;
}

export interface AppUrlChangeEvent {
    source: unknown;
    origin: string;
    data: unknown;
}

export interface AppUrlChangeContext {
    parent: unknown;
    bkperOrigin: string;
    appOrigin: string;
}

export function getAppUrlChange(
    event: AppUrlChangeEvent,
    context: AppUrlChangeContext
): URL | null {
    if (event.source !== context.parent || event.origin !== context.bkperOrigin) {
        return null;
    }

    if (!isRecord(event.data)) {
        return null;
    }

    if (event.data.type !== 'bkper:app-url-changed' || typeof event.data.url !== 'string') {
        return null;
    }

    try {
        const nextUrl = new URL(event.data.url);
        return nextUrl.origin === context.appOrigin ? nextUrl : null;
    } catch {
        return null;
    }
}

export function getMenuContext(search: string): MenuContext {
    const params = new URLSearchParams(search);

    return {
        bookId: params.get('bookId') ?? params.get('ledgerId'),
        query: normalizeQuery(params.get('query')),
    };
}

function normalizeQuery(query: string | null): string {
    if (query == null) {
        return '';
    }

    const trimmedQuery = query.trim();
    const normalizedQuery = trimmedQuery.toLowerCase();

    if (
        trimmedQuery === '' ||
        normalizedQuery === 'undefined' ||
        normalizedQuery === 'null' ||
        isUnresolvedMenuExpression(trimmedQuery)
    ) {
        return '';
    }

    return query;
}

function isUnresolvedMenuExpression(value: string): boolean {
    return /^\$\{[^}]+}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
