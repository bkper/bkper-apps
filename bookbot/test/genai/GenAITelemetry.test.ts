import { describe, expect, it } from 'bun:test';
import { getBase64DecodedSize, getFileSizeBucket } from '../../src/genai/GenAITelemetry.js';

describe('GenAI telemetry metadata helpers', () => {
    it('calculates decoded base64 size without reading payload content', () => {
        expect(getBase64DecodedSize('')).toBe(0);
        expect(getBase64DecodedSize('SGVsbG8=')).toBe(5);
        expect(getBase64DecodedSize('U29tZSB0ZXh0')).toBe(9);
    });

    it('classifies file sizes at reporting boundaries', () => {
        const megabyte = 1024 * 1024;

        expect(getFileSizeBucket(megabyte - 1)).toBe('under_1mb');
        expect(getFileSizeBucket(megabyte)).toBe('1mb_5mb');
        expect(getFileSizeBucket(5 * megabyte)).toBe('5mb_10mb');
        expect(getFileSizeBucket(10 * megabyte)).toBe('10mb_25mb');
        expect(getFileSizeBucket(25 * megabyte)).toBe('25mb_plus');
    });
});
