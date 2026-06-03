export interface MenuContext {
    bookId: string | null;
    query: string;
}

export function getMenuContext(search: string): MenuContext {
    const params = new URLSearchParams(search);
    const query = params.get('query') ?? '';

    return {
        bookId: params.get('bookId') ?? params.get('ledgerId'),
        query: normalizeQuery(query),
    };
}

function normalizeQuery(query: string): string {
    const trimmedQuery = query.trim();
    return trimmedQuery === 'undefined' || trimmedQuery === 'null' ? '' : query;
}
