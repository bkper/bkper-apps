/**
 * Tiny drawings of a report's charts, for the previews above its chart: the shape of each chart
 * from the spec's numbers, in the colors the chart uses, with no labels, axes or tooltips. Plain
 * SVG, so a dozen of them cost next to nothing to draw. A kind without data (the table, or a
 * chart asked for that does not fit) gets a sketch of its shape, in the text's color.
 */
import { html, svg, type SVGTemplateResult, type TemplateResult } from 'lit';
import { hollow, shades, typeColor } from './colors.js';
import { ReportFormat } from './format.js';
import type { PropsOf, ViewKind } from './spec-types.js';

type ChartProps = PropsOf<'Chart'>;

/** The drawing's coordinates; it scales to its box, keeping its shape. */
const WIDTH = 64;
const HEIGHT = 40;
const PAD = 3;
const STROKE = 1.5;
const VIEW_BOX = `0 0 ${WIDTH} ${HEIGHT}`;

/** The most parts a preview draws one by one: the largest come first. */
const MAX_PARTS = 6;
const MAX_PAIRS = 4;

/** The widest bar or group of bars of a month, so a few months do not fill the drawing. */
const MAX_GROUP = 9;

/** Sketches take the text's color, which reads on either theme. */
const SKETCH = 'currentColor';

/** Rings start at the top. */
const ROTATE = `rotate(-90 ${WIDTH / 2} ${HEIGHT / 2})`;

interface Series {
    values: number[];
    color: string;
    line?: boolean;
}

interface Part {
    value: number;
    color: string;
}

/** The drawing of a chart, or a sketch of its kind when there is no chart to draw. */
export function renderPreview(kind: ViewKind, chart?: ChartProps): TemplateResult {
    const drawn = chart ? drawing(chart) : sketch(kind);
    return html`<svg viewBox=${VIEW_BOX} aria-hidden="true" focusable="false">${drawn}</svg>`;
}

function drawing(chart: ChartProps): SVGTemplateResult[] {
    const plot = ReportFormat.plot;
    switch (chart.kind) {
        case 'bar':
        case 'line':
        case 'area':
        case 'stacked': {
            const colors =
                chart.kind === 'stacked' ? shades(chart.series.map(series => series.color)) : [];
            return byMonth(
                chart.kind,
                chart.series.map((series, index) => {
                    const line = 'line' in series && series.line === true;
                    const tone = chart.kind === 'line' || line ? 'high' : 'medium';
                    return {
                        values: series.values.map(plot),
                        color: colors[index] ?? typeColor(series.color, tone),
                        line,
                    };
                })
            );
        }
        case 'ranked-bar':
            return ranked(
                chart.items.map(item => ({
                    value: plot(item.value),
                    color: typeColor(item.color, 'medium'),
                }))
            );
        case 'donut':
        case 'pie': {
            const colors = shades(chart.items.map(item => item.color));
            return ring(
                chart.items.map((item, index) => ({
                    value: plot(item.value),
                    color: colors[index],
                })),
                chart.kind === 'donut'
            );
        }
        case 'compare':
            return pairs(
                chart.items.map(item => ({
                    value: plot(item.value),
                    previous: plot(item.previous),
                    color: typeColor(item.color, 'high'),
                }))
            );
        case 'waterfall':
            return bridge(
                plot(chart.start.value),
                chart.steps.map(step => ({
                    value: plot(step.value),
                    color: typeColor(step.color, 'medium'),
                })),
                typeColor(chart.start.color, 'high'),
                typeColor(chart.end.color, 'high')
            );
    }
}

/** The shape of a kind, with made-up numbers, for the table or a chart that does not fit. */
function sketch(kind: ViewKind): SVGTemplateResult[] {
    const months = [3, 5, 4, 6, 5, 7];
    switch (kind) {
        case 'bar':
        case 'line':
        case 'area':
            return byMonth(kind, [{ values: months, color: SKETCH }]);
        case 'stacked':
            return byMonth(kind, [
                { values: months, color: SKETCH },
                { values: months.map(value => value / 2), color: hollow(SKETCH) },
            ]);
        case 'ranked-bar':
            return ranked([6, 4, 3, 2].map(value => ({ value, color: SKETCH })));
        case 'donut':
        case 'pie':
            return ring(
                [5, 3, 2].map((value, index) => ({
                    value,
                    color: index === 1 ? hollow(SKETCH) : SKETCH,
                })),
                kind === 'donut'
            );
        case 'compare':
            return pairs([6, 4, 3].map(value => ({ value, previous: value - 1, color: SKETCH })));
        case 'waterfall':
            return bridge(
                6,
                [-2, -1.5, -1].map(value => ({ value, color: SKETCH })),
                SKETCH,
                SKETCH
            );
        case 'table':
            return table();
    }
}

/**
 * Maps values to coordinates from `from` to `to`, zero included as bars and areas stand on it;
 * a line, like the chart's, spans its values alone.
 */
function scale(values: number[], from: number, to: number, zero = true): (value: number) => number {
    const min = Math.min(...(zero ? [0] : []), ...values);
    const max = Math.max(...(zero ? [0] : []), ...values);
    const span = max - min || 1;
    return value => from + ((value - min) / span) * (to - from);
}

function bar(x: number, y: number, width: number, height: number, fill: string, stroke?: string) {
    const line = stroke ? 1 : 0;
    return svg`<rect x=${round(x)} y=${round(y)} width=${round(Math.max(width, 0.3))} height=${round(Math.max(height, 0.3))} fill=${fill} stroke=${stroke ?? 'none'} stroke-width=${line}></rect>`;
}

/** Bars of each month side by side, stacked parts, lines or areas; lines over the rest. */
function byMonth(kind: 'bar' | 'line' | 'area' | 'stacked', series: Series[]): SVGTemplateResult[] {
    const count = series[0]?.values.length ?? 0;
    if (count === 0) return [];
    const slot = (WIDTH - 2 * PAD) / count;
    const center = (index: number) => PAD + slot * (index + 0.5);
    if (kind === 'stacked') {
        const tops = Array.from({ length: count }, (_, month) =>
            series.reduce((sum, entry) => sum + Math.max(entry.values[month], 0), 0)
        );
        const bottoms = Array.from({ length: count }, (_, month) =>
            series.reduce((sum, entry) => sum + Math.min(entry.values[month], 0), 0)
        );
        const y = scale([...tops, ...bottoms], HEIGHT - PAD, PAD);
        const up = new Array<number>(count).fill(0);
        const down = new Array<number>(count).fill(0);
        return series.flatMap(entry =>
            entry.values.map((value, month) => {
                const level = value >= 0 ? up : down;
                const from = level[month];
                level[month] += value;
                const top = Math.min(y(from), y(level[month]));
                const width = Math.min(slot * 0.72, MAX_GROUP);
                return bar(
                    center(month) - width / 2,
                    top,
                    width,
                    Math.abs(y(level[month]) - y(from)),
                    entry.color
                );
            })
        );
    }
    const y = scale(
        series.flatMap(entry => entry.values),
        HEIGHT - PAD,
        PAD,
        kind !== 'line'
    );
    const columns = kind === 'bar' ? series.filter(entry => !entry.line) : [];
    const lines = kind === 'bar' ? series.filter(entry => entry.line) : series;
    const group = Math.min(slot * 0.72, MAX_GROUP);
    const width = group / Math.max(columns.length, 1);
    const drawn: SVGTemplateResult[] = columns.flatMap((entry, index) =>
        entry.values.map((value, month) =>
            bar(
                center(month) - group / 2 + index * width,
                Math.min(y(value), y(0)),
                width,
                Math.abs(y(value) - y(0)),
                entry.color
            )
        )
    );
    for (const entry of lines) {
        const points = entry.values.map(
            (value, month) => `${round(center(month))},${round(y(value))}`
        );
        if (kind === 'area' && !entry.line) {
            const base = round(y(0));
            drawn.push(
                svg`<path d=${`M${round(center(0))},${base}L${points.join('L')}L${round(center(count - 1))},${base}Z`} fill=${hollow(entry.color)} stroke="none"></path>`
            );
        }
        drawn.push(
            count === 1
                ? svg`<circle cx=${round(center(0))} cy=${round(y(entry.values[0]))} r=${STROKE} fill=${entry.color}></circle>`
                : svg`<polyline points=${points.join(' ')} fill="none" stroke=${entry.color} stroke-width=${STROKE} stroke-linejoin="round" stroke-linecap="round"></polyline>`
        );
    }
    return drawn;
}

/** The largest parts as bars from zero, one row each; a negative one goes the other way. */
function ranked(parts: Part[]): SVGTemplateResult[] {
    const shown = parts.slice(0, MAX_PARTS);
    const x = scale(
        shown.map(part => part.value),
        PAD,
        WIDTH - PAD
    );
    const row = (HEIGHT - 2 * PAD) / Math.max(shown.length, 1);
    return shown.map((part, index) =>
        bar(
            Math.min(x(part.value), x(0)),
            PAD + index * row + row * 0.15,
            Math.abs(x(part.value) - x(0)),
            row * 0.7,
            part.color
        )
    );
}

/** Each part's share of a circle: a pie, or a ring with a hole. */
function ring(parts: Part[], hole: boolean): SVGTemplateResult[] {
    const total = parts.reduce((sum, part) => sum + Math.abs(part.value), 0) || 1;
    const outer = HEIGHT / 2 - PAD / 2;
    // A stroke as wide as the radius draws a pie; a narrower one a ring.
    const width = hole ? outer * 0.42 : outer;
    const radius = outer - width / 2;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    return parts.map(part => {
        const length = (Math.abs(part.value) / total) * circumference;
        const dash = `${round(length)} ${round(circumference)}`;
        const drawn = svg`<circle cx=${WIDTH / 2} cy=${HEIGHT / 2} r=${round(radius)} fill="none" stroke=${part.color} stroke-width=${round(width)} stroke-dasharray=${dash} stroke-dashoffset=${round(-offset)} transform=${ROTATE}></circle>`;
        offset += length;
        return drawn;
    });
}

/** Each part before (outlined) and now (solid), side by side. */
function pairs(parts: (Part & { previous: number })[]): SVGTemplateResult[] {
    const shown = parts.slice(0, MAX_PAIRS);
    const x = scale(
        shown.flatMap(part => [part.value, part.previous]),
        PAD,
        WIDTH - PAD
    );
    const row = (HEIGHT - 2 * PAD) / Math.max(shown.length, 1);
    const height = row * 0.36;
    return shown.flatMap((part, index) => {
        const top = PAD + index * row + row * 0.12;
        return [
            bar(
                Math.min(x(part.previous), x(0)),
                top,
                Math.abs(x(part.previous) - x(0)),
                height,
                hollow(part.color),
                part.color
            ),
            bar(
                Math.min(x(part.value), x(0)),
                top + height,
                Math.abs(x(part.value) - x(0)),
                height,
                part.color
            ),
        ];
    });
}

/** From the start, each step floating from where the one before ended, to the end. */
function bridge(start: number, steps: Part[], startColor: string, endColor: string) {
    const bars: { from: number; to: number; color: string; down: boolean }[] = [
        { from: 0, to: start, color: startColor, down: false },
    ];
    let level = start;
    for (const step of steps) {
        bars.push({ from: level, to: level + step.value, color: step.color, down: step.value < 0 });
        level += step.value;
    }
    bars.push({ from: 0, to: level, color: endColor, down: false });
    const x = scale(
        bars.flatMap(entry => [entry.from, entry.to]),
        PAD,
        WIDTH - PAD
    );
    const row = (HEIGHT - 2 * PAD) / bars.length;
    return bars.map((entry, index) =>
        bar(
            Math.min(x(entry.from), x(entry.to)),
            PAD + index * row + row * 0.15,
            Math.abs(x(entry.to) - x(entry.from)),
            row * 0.7,
            entry.down ? hollow(entry.color) : entry.color,
            entry.down ? entry.color : undefined
        )
    );
}

/** Rows of a table: a name and an amount each. */
function table(): SVGTemplateResult[] {
    const rows = 4;
    const row = (HEIGHT - 2 * PAD) / rows;
    return Array.from({ length: rows }, (_, index) => {
        const y = PAD + index * row + row / 2;
        return svg`<line x1=${PAD} y1=${round(y)} x2=${WIDTH * 0.55} y2=${round(y)} stroke=${SKETCH} stroke-width=${STROKE} stroke-linecap="round"></line>
            <line x1=${WIDTH * 0.72} y1=${round(y)} x2=${WIDTH - PAD} y2=${round(y)} stroke=${SKETCH} stroke-width=${STROKE} stroke-linecap="round"></line>`;
    });
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}
