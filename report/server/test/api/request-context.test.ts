import { describe, expect, it } from 'vitest';
import { acceptedLanguage, reportAppUrl } from '../../src/api/request-context';

describe('acceptedLanguage', () => {
    it('picks the most preferred Bkper language', () => {
        expect(acceptedLanguage('pt-BR,pt;q=0.9,en;q=0.8')).toBe('pt');
        expect(acceptedLanguage('tlh;q=1, de;q=0.5, fr;q=0.7')).toBe('fr');
        expect(acceptedLanguage('*, ja')).toBe('ja');
    });

    it('ignores refused, unknown or missing languages', () => {
        expect(acceptedLanguage('es;q=0, xx-invalid-tag-')).toBeUndefined();
        expect(acceptedLanguage('')).toBeUndefined();
        expect(acceptedLanguage(undefined)).toBeUndefined();
    });
});

describe('reportAppUrl', () => {
    it('opens the request in the Report app of the environment the API was reached on', () => {
        expect(
            reportAppUrl('https://report.bkper.app/api/v1/books/b1/report', 'b1', 'gastos 2010')
        ).toBe('https://report.bkper.app/?book=b1&q=gastos+2010');
        expect(
            reportAppUrl('https://report-preview.bkper.app/api/v1/books/b1/report', 'b1', 'a&b')
        ).toBe('https://report-preview.bkper.app/?book=b1&q=a%26b');
        expect(reportAppUrl('http://localhost:8809/api/v1/books/b1/report', 'b1', 'x')).toBe(
            'https://report.bkper.app/?book=b1&q=x'
        );
    });
});
