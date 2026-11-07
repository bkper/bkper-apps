import { describe, expect, it } from 'vitest';
import { RELATIVE_PERIODS, REPORT_CHARTS, REPORT_VIEWS } from '../src/report-intent';
import {
    MAX_STATE_LENGTH,
    decodeReportState,
    encodeReportState,
    stateFromUrlValue,
    type ReportState,
} from '../src/report-state';

const STATE_RULE = /^[A-Za-z0-9_-]{1,128}$/;

function roundTrip(state: ReportState): ReportState | undefined {
    const encoded = encodeReportState(state);
    expect(encoded).toMatch(STATE_RULE);
    return decodeReportState(encoded ?? '');
}

describe('report state', () => {
    it('round-trips every view, chart and month flag', () => {
        for (const view of [undefined, ...REPORT_VIEWS]) {
            for (const chart of REPORT_CHARTS.filter(chart => chart !== 'auto')) {
                for (const monthly of [false, true]) {
                    const state: ReportState = {
                        intent: {
                            root: '191002',
                            period: '2017',
                            monthly,
                            ...(view ? { view } : {}),
                            chart,
                        },
                    };
                    expect(roundTrip(state)).toEqual(state);
                }
            }
        }
    });

    it('opens states written before more charts could be preferred, unchanged', () => {
        expect(decodeReportState('1MGJwLjIwMTcucHQuLjE5MTAwMg')).toEqual({
            intent: {
                root: '191002',
                period: '2017',
                monthly: false,
                view: 'breakdown',
                chart: 'pie',
            },
            language: 'pt',
        });
        expect(decodeReportState('1MXRhLjIwMTcuLi4xOTEwMDI')).toEqual({
            intent: { root: '191002', period: '2017', monthly: true, view: 'trend' },
        });
    });

    it('round-trips every kind of period', () => {
        for (const period of [...RELATIVE_PERIODS, '2017', '2017-Q4', '2017-03', '1999-12']) {
            const state: ReportState = { intent: { root: 'net-result', period, monthly: false } };
            expect(roundTrip(state)).toEqual(state);
        }
    });

    it('round-trips hashtags, the language and any root id', () => {
        const state: ReportState = {
            intent: {
                root: 'grupo-ÿ.com/é|x',
                period: 'last_12_months',
                monthly: true,
                view: 'trend',
                chart: 'stacked',
                hashtags: ['viagem', 'trip_2019', 'çà-ü'],
            },
            language: 'pt',
        };
        expect(roundTrip(state)).toEqual(state);
    });

    it('round-trips a target under its root', () => {
        const state: ReportState = {
            intent: {
                root: 'grupo-ÿ.com/é|x',
                target: '5687803178385408',
                period: '2017-Q4',
                monthly: true,
                chart: 'line',
                hashtags: ['viagem'],
            },
            language: 'ar',
        };
        expect(roundTrip(state)).toEqual(state);
        // A state of the same report without a target is the one written before targets.
        const { target: _target, ...root } = state.intent;
        expect(encodeReportState({ intent: root })?.[0]).toBe('1');
        expect(encodeReportState(state)?.[0]).toBe('2');
    });

    it('opens states written before targets, unchanged, as the whole root', () => {
        for (const state of ['1MGJwLjIwMTcucHQuLjE5MTAwMg', '1MXRhLjIwMTcuLi4xOTEwMDI']) {
            const decoded = decodeReportState(state);
            expect(decoded?.intent.target).toBeUndefined();
            expect(decoded && encodeReportState(decoded)).toBe(state);
        }
    });

    it('leaves out no chart and auto alike, so both open the rules’ chart', () => {
        const intent = { root: 'r', period: '2018', monthly: false };
        expect(encodeReportState({ intent: { ...intent, chart: 'auto' } })).toBe(
            encodeReportState({ intent })
        );
        expect(roundTrip({ intent: { ...intent, chart: 'auto' } })).toEqual({ intent });
    });

    it('fits the length limit, or gives no state', () => {
        const intent = { period: '2018', monthly: false };
        const fits = (root: string) => encodeReportState({ intent: { ...intent, root } });
        let length = 1;
        while (fits('a'.repeat(length + 1))) length++;
        const longest = fits('a'.repeat(length));
        expect(longest?.length).toBeLessThanOrEqual(MAX_STATE_LENGTH);
        expect(longest?.length).toBeGreaterThan(MAX_STATE_LENGTH - 4);
        expect(decodeReportState(longest ?? '')?.intent.root).toBe('a'.repeat(length));
        expect(fits('a'.repeat(length + 1))).toBeUndefined();
        const tag = 'a'.repeat(100);
        expect(encodeReportState({ intent: { ...intent, root: 'x', hashtags: [tag] } })).toBe(
            undefined
        );
    });

    it('gives no state for an intent it could not open again', () => {
        const intent = { root: 'r', period: '2018', monthly: false };
        expect(encodeReportState({ intent: { ...intent, root: '' } })).toBeUndefined();
        expect(encodeReportState({ intent: { ...intent, period: '2018-13' } })).toBeUndefined();
        expect(encodeReportState({ intent: { ...intent, hashtags: ['a b'] } })).toBeUndefined();
        expect(encodeReportState({ intent, language: 'xx-unknown' })).toBeUndefined();
        expect(encodeReportState({ intent: { ...intent, target: '' } })).toBeUndefined();
        // A target is written before the root, so it cannot hold the separator.
        expect(encodeReportState({ intent: { ...intent, target: 'a.b' } })).toBeUndefined();
        expect(
            encodeReportState({ intent: { ...intent, target: 't'.repeat(201) } })
        ).toBeUndefined();
    });

    it('fits a target and its root in the length limit, or gives no state', () => {
        // Bkper ids are at most 16 digits today.
        const intent = {
            root: '5694067388186624',
            target: '5687803178385408',
            period: 'last_12_months',
            monthly: true,
            view: 'trend' as const,
            chart: 'stacked' as const,
            hashtags: ['viagem', 'trip_2019'],
        };
        expect(roundTrip({ intent, language: 'pt' })).toEqual({ intent, language: 'pt' });
        expect(encodeReportState({ intent: { ...intent, target: 't'.repeat(80) } })).toBe(
            undefined
        );
    });

    it('ignores states that are not one it wrote', () => {
        const valid = encodeReportState({ intent: { root: 'r', period: '2018', monthly: false } });
        const invalid = [
            '',
            'x',
            '1',
            '2' + (valid ?? '').slice(1),
            (valid ?? '') + '!',
            'a'.repeat(MAX_STATE_LENGTH + 1),
            '${app.state}',
            '1' + base64url('0_a.2018..'),
            '1' + base64url('0_a.2018...'),
            '1' + base64url('2_a.2018...r'),
            '1' + base64url('0za.2018...r'),
            '1' + base64url('0_z.2018...r'),
            '1' + base64url('0_a.2018-13...r'),
            '1' + base64url('0_a.2018.xx-unknown..r'),
            '1' + base64url('0_a.2018..a b.r'),
            '1' + base64url('0_a.2018..a,,b.r'),
            '1' + base64url('0_a.2018...' + 'r'.repeat(201)),
            '1' + base64url('0_a.2018..' + Array(11).fill('t').join(',') + '.r'),
            // A target state has a target, and a state without one is written as before.
            '2' + base64url('0_a.2018....r'),
            '2' + base64url('0_a.2018...t'),
            '2' + base64url('0_a.2018...t.'),
            '2' + base64url('0_a.2018...' + 't'.repeat(201) + '.r'),
            '1AA',
            '1_w',
        ];
        for (const state of invalid) expect(decodeReportState(state), state).toBeUndefined();
        // Malformed UTF-8.
        expect(decodeReportState('1' + 'wA')).toBeUndefined();
    });

    it('reads a missing, empty or unreplaced menu URL value as no state', () => {
        expect(stateFromUrlValue(null)).toBeUndefined();
        expect(stateFromUrlValue('')).toBeUndefined();
        expect(stateFromUrlValue('${app.state}')).toBeUndefined();
        expect(stateFromUrlValue('abc')).toBe('abc');
    });
});

/** Base64url of the UTF-8 of `text`, written here apart from the module's own. */
function base64url(text: string): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const bytes = [...encodeURIComponent(text).matchAll(/%([0-9A-F]{2})|./g)].map(([char, hex]) =>
        hex ? parseInt(hex, 16) : char.charCodeAt(0)
    );
    let bits = '';
    for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
    let out = '';
    for (let index = 0; index < bits.length; index += 6) {
        out += alphabet[parseInt(bits.slice(index, index + 6).padEnd(6, '0'), 2)];
    }
    return out;
}
