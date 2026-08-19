import { describe, expect, it } from 'bun:test';
import { isApiError, isBookAccessRequiredError, isNotFoundError } from '../src/errors.js';

describe('Error classification', () => {
    it('identifies Book access errors by status and API message', () => {
        const message =
            'The user [user@example.com] is not a collaborator on the book [USD Book - book-id]';

        expect(isBookAccessRequiredError({ status: 401, message })).toBe(true);
        expect(isBookAccessRequiredError({ code: 401, message })).toBe(true);
        expect(isBookAccessRequiredError({ status: 401, message: 'Login required' })).toBe(false);
    });

    it('identifies invalid and missing errors', () => {
        expect(isNotFoundError({ status: 400 })).toBe(true);
        expect(isNotFoundError({ code: 404 })).toBe(true);
        expect(isNotFoundError({ status: 500 })).toBe(false);
    });

    it('identifies typed API error payloads', () => {
        expect(isApiError({ error: { message: 'Rates unavailable' } })).toBe(true);
        expect(isApiError({ error: { message: 500 } })).toBe(false);
        expect(isApiError({ message: 'Rates unavailable' })).toBe(false);
    });

    it('rejects malformed errors', () => {
        expect(isBookAccessRequiredError(null)).toBe(false);
        expect(isNotFoundError(new Error('Book unavailable'))).toBe(false);
        expect(isApiError(null)).toBe(false);
    });
});
