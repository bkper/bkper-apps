import { describe, expect, it } from 'vitest';
import { REPORT_CHARTS } from '../src/report-intent';
import {
    MAX_PROMPT_LENGTH,
    MAX_STATE_LENGTH,
    decodeUrlState,
    encodeUrlState,
    stateFromUrlValue,
    type StateChart,
    type UrlState,
} from '../src/url-state';

/** What Bkper keeps as app state. */
const STATE_RULE = /^[A-Za-z0-9_-]{1,1024}$/;

function roundTrip(state: UrlState): UrlState | undefined {
    const encoded = encodeUrlState(state);
    expect(encoded).toMatch(STATE_RULE);
    return decodeUrlState(encoded ?? '');
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** The base64url of a text's UTF-8, written here apart from the module's own. */
function base64url(text: string): string {
    const bytes = [...unescape(encodeURIComponent(text))].map(char => char.charCodeAt(0));
    let out = '';
    for (let index = 0; index < bytes.length; index += 3) {
        const [a, b = 0, c = 0] = bytes.slice(index, index + 3);
        const chunk = (a << 16) | (b << 8) | c;
        const chars = Math.min(4, Math.ceil(((bytes.length - index) * 8) / 6));
        for (let char = 0; char < chars; char++) out += BASE64URL[(chunk >> (18 - 6 * char)) & 63];
    }
    return out;
}

/** A state of 11 bytes with the last of the bits after them set: the same bytes, written otherwise. */
function withPaddingBit(state: string): string {
    expect(state).toHaveLength(1 + 15);
    return state.slice(0, -1) + BASE64URL[BASE64URL.indexOf(state.slice(-1)) + 1];
}

describe('url state', () => {
    it('opens the same text, language and chart again', () => {
        const states: UrlState[] = [
            { text: 'Expenses this year', language: 'en' },
            { text: 'Despesas por mês em 2018', language: 'pt', chart: 'stacked' },
            { text: '費用 今年', language: 'zh-TW' },
            { text: 'Expenses Q3 2024 vs. Q1 2024 #travel', language: 'en', chart: 'compare' },
        ];
        for (const state of states) expect(roundTrip(state)).toEqual(state);
        for (const chart of REPORT_CHARTS.filter(chart => chart !== 'auto')) {
            const state = { text: 'Expenses', language: 'en', chart };
            expect(roundTrip(state), chart).toEqual(state);
        }
    });

    it('keeps texts of any script, and dots, whole', () => {
        const states: UrlState[] = [
            { text: 'المصروفات هذا العام مقارنة بـ 2023', language: 'ar' },
            { text: '費用 前四半期', language: 'ja', chart: 'pie' },
            { text: 'Food 🍕 and Rent. by month', language: 'en' },
            { text: 'Café e Água… 1.000,00', language: 'pt' },
        ];
        for (const state of states) expect(roundTrip(state)).toEqual(state);
    });

    it('asks for no chart as the report’s own choice', () => {
        expect(
            encodeUrlState({ text: 'Expenses', language: 'en', chart: 'auto' as StateChart })
        ).toBeUndefined();
        expect(encodeUrlState({ text: 'Expenses', language: 'en', chart: undefined })).toBe(
            encodeUrlState({ text: 'Expenses', language: 'en' })
        );
    });

    it('keeps no state longer than Bkper keeps', () => {
        const fits = (text: string) => encodeUrlState({ text, language: 'en' });
        // `5`, then 4 letters per 3 bytes of `en..` and the text, the last ones partly.
        const longest = 'a'.repeat(763);
        expect(fits(longest)).toHaveLength(MAX_STATE_LENGTH);
        expect(decodeUrlState(fits(longest) ?? '')?.text).toBe(longest);
        expect(fits(longest + 'a')).toBeUndefined();
        // Three bytes each in UTF-8: fewer letters fit.
        expect(fits('費'.repeat(300))).toBeUndefined();
        expect(fits('費'.repeat(250))).toMatch(STATE_RULE);
    });

    it('writes no state of a text no report accepts, or of an unknown language or chart', () => {
        const state = (value: Partial<UrlState>) =>
            encodeUrlState({ text: 'Expenses', language: 'en', ...value });
        expect(state({ text: '' })).toBeUndefined();
        expect(state({ text: ' Expenses' })).toBeUndefined();
        expect(state({ text: 'Expenses\n' })).toBeUndefined();
        expect(state({ text: 'a'.repeat(MAX_PROMPT_LENGTH + 1) })).toBeUndefined();
        expect(state({ text: '\ud800' })).toBeUndefined();
        expect(state({ language: 'xx-unknown' })).toBeUndefined();
        expect(state({ language: '' })).toBeUndefined();
        expect(state({ chart: 'radar' as StateChart })).toBeUndefined();
    });

    it('reads anything but a state it writes as no state', () => {
        const valid = encodeUrlState({ text: 'Expenses this year', language: 'en' }) ?? '';
        expect(decodeUrlState('5' + base64url('pt.pie.Despesas'))).toEqual({
            text: 'Despesas',
            language: 'pt',
            chart: 'pie',
        });
        const invalid = [
            '',
            '5',
            valid + '!',
            '6' + valid.slice(1),
            // The bits after the last byte are written as zeros.
            withPaddingBit(encodeUrlState({ text: 'Expense', language: 'en' }) ?? ''),
            'a'.repeat(MAX_STATE_LENGTH + 1),
            '5' + 'A'.repeat(MAX_STATE_LENGTH),
            '${app.state}',
            '5' + base64url('en.Expenses'),
            '5' + base64url('en..'),
            '5' + base64url('en.. Expenses'),
            '5' + base64url('xx..Expenses'),
            '5' + base64url('.pie.Expenses'),
            '5' + base64url('en.auto.Expenses'),
            '5' + base64url('en.radar.Expenses'),
            // Malformed UTF-8.
            '5wA',
        ];
        for (const state of invalid) expect(decodeUrlState(state), state).toBeUndefined();
    });

    it('reads the compact intents written before as no state', () => {
        // A report of the year 2017 by intent, and one of a target, as they were written.
        expect(decodeUrlState('1MGJwLjIwMTcucHQuLjE5MTAwMg')).toBeUndefined();
        expect(decodeUrlState('1MXRhLjIwMTcuLi4xOTEwMDI')).toBeUndefined();
        expect(decodeUrlState('4' + base64url('0_a.yp__~2023__.pt....191002'))).toBeUndefined();
    });

    it('reads a missing, empty or unreplaced menu URL value as no state', () => {
        expect(stateFromUrlValue(null)).toBeUndefined();
        expect(stateFromUrlValue(undefined)).toBeUndefined();
        expect(stateFromUrlValue('')).toBeUndefined();
        expect(stateFromUrlValue('${app.state}')).toBeUndefined();
        expect(stateFromUrlValue('abc')).toBe('abc');
    });
});
