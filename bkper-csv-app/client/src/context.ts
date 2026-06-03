export interface MenuContext {
    bookId: string | null;
    query: string;
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
