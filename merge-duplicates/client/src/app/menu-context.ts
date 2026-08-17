export interface CapturedMenuContext {
    bookId: string | null;
    query: string;
    accountId: string | null;
    groupId: string | null;
}

export function getMenuContext(search: string): CapturedMenuContext {
    const params = new URLSearchParams(search);
    return {
        bookId: normalize(params.get('bookId') ?? params.get('ledgerId')),
        query: normalize(params.get('query')) ?? '',
        accountId: normalize(params.get('accountId')),
        groupId: normalize(params.get('groupId')),
    };
}

function normalize(value: string | null): string | null {
    if (value === null) return null;
    const trimmed = value.trim();
    if (
        !trimmed ||
        trimmed === 'undefined' ||
        trimmed === 'null' ||
        /^\$\{[^}]+\}$/u.test(trimmed)
    ) {
        return null;
    }
    return value;
}
