import { describe, expect, it } from 'vitest';
import { environmentBkperOrigin } from '../src/bkper-host';

describe('environmentBkperOrigin', () => {
    it('opens Bkper in development from the preview app, else in production', () => {
        expect(environmentBkperOrigin('https://report-preview.bkper.app')).toBe(
            'https://dev.bkper.app'
        );
        expect(environmentBkperOrigin('https://report.bkper.app')).toBe('https://bkper.app');
        // Run locally, the app reads production Books with the developer's own credentials.
        expect(environmentBkperOrigin('http://localhost:5207')).toBe('https://bkper.app');
        expect(environmentBkperOrigin('null')).toBe('https://bkper.app');
    });
});
