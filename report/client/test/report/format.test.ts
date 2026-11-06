import { describe, expect, it } from 'vitest';
import { ReportFormat } from '../../src/report/format';

describe('ReportFormat', () => {
    it('formats decimal amounts exactly, with the Book fraction digits, in the locale', () => {
        expect(new ReportFormat('en', 2).amount('12345678901234567.8')).toBe(
            '12,345,678,901,234,567.80'
        );
        expect(new ReportFormat('pt-BR', 2).amount('-354.3')).toBe('-354,30');
        expect(new ReportFormat('ja', 0).amount('1234.5')).toBe('1,235');
        expect(new ReportFormat('ar-EG', 2).amount('1234.5')).toBe('١٬٢٣٤٫٥٠');
    });

    it('rejects amounts that are not decimal strings', () => {
        expect(() => new ReportFormat('en', 2).amount('1e3')).toThrow('decimal');
    });

    it('formats changes with their sign and shares without, as percentages', () => {
        const format = new ReportFormat('en', 2);
        expect(format.change('0.1234')).toBe('+12.3%');
        expect(format.change('-0.5')).toBe('-50%');
        expect(format.change('0')).toBe('0%');
        expect(format.share('0.9873')).toBe('98.7%');
        expect(new ReportFormat('pt-BR', 2).change('1.0129')).toBe('+101,3%');
    });

    it('never shows a signed zero, and a tiny share other than zero as under its precision', () => {
        const format = new ReportFormat('en', 2);
        expect(format.share('0')).toBe('0%');
        expect(format.share('-0.0004')).toBe('<0.1%');
        expect(format.share('0.0004')).toBe('<0.1%');
        expect(format.share('-0.0005')).toBe('-0.1%');
        expect(format.share('-0.25')).toBe('-25%');
        expect(format.change('-0.0004')).toBe('0%');
        expect(format.change('0.0004')).toBe('0%');
        expect(new ReportFormat('pt-BR', 2).share('-0.0004')).toBe('<0,1%');
        expect(new ReportFormat('ar-EG', 2).share('-0.0004')).toBe('<٠٫١٪؜');
    });

    it('abbreviates axis values', () => {
        expect(new ReportFormat('en', 2).compact(12500)).toBe('12.5K');
        expect(new ReportFormat('ja', 2).compact(12500)).toBe('1.3万');
    });

    it('names months as calendar months, short for axes and long for tooltips', () => {
        const format = new ReportFormat('en', 2);
        expect(format.month('2025-01', 'short')).toBe('Jan');
        expect(format.month('2025-01', 'year')).toBe('Jan 25');
        expect(format.month('2025-12', 'long')).toBe('December 2025');
        expect(new ReportFormat('pt-BR', 2).month('2025-03', 'long')).toBe('março de 2025');
        expect(new ReportFormat('ja', 2).month('2025-03', 'long')).toBe('2025年3月');
    });

    it('formats an instant in a time zone', () => {
        const format = new ReportFormat('en', 2, 'America/Sao_Paulo');
        expect(format.instant('2026-11-05T15:00:00.000Z')).toBe('Nov 5, 2026, 12:00 PM');
    });
});
