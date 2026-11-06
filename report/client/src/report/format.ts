/**
 * Formats the raw values of a report spec for people, in the report's locale: amounts and
 * ratios arrive as decimal strings and are formatted exactly (never through binary floats),
 * months as `YYYY-MM` calendar months, and instants as ISO date-times.
 */

const DECIMAL = /^-?(0|[1-9]\d*)(\.\d+)?$/;

type DecimalString = `${number}`;

function isDecimal(value: string): value is DecimalString {
    return DECIMAL.test(value);
}

function decimal(value: string): DecimalString {
    if (!isDecimal(value)) {
        throw new Error(`Expected a decimal string: ${value}`);
    }
    return value;
}

/** How a month is named: `short` (Jan), `year` (Jan 25) or `long` (January 2025). */
export type MonthStyle = 'short' | 'year' | 'long';

const MONTH_OPTIONS: Record<MonthStyle, Intl.DateTimeFormatOptions> = {
    short: { month: 'short' },
    year: { month: 'short', year: '2-digit' },
    long: { month: 'long', year: 'numeric' },
};

export class ReportFormat {
    private readonly amounts: Intl.NumberFormat;
    private readonly changes: Intl.NumberFormat;
    private readonly shares: Intl.NumberFormat;
    private readonly compacts: Intl.NumberFormat;
    private readonly instants: Intl.DateTimeFormat;
    private readonly months = new Map<MonthStyle, Intl.DateTimeFormat>();

    /**
     * @param locale The report's locale.
     * @param fractionDigits Decimal places of the Book's amounts.
     * @param timeZone Time zone of instants; the viewer's by default.
     */
    constructor(
        readonly locale: string,
        readonly fractionDigits: number,
        private readonly timeZone?: string
    ) {
        this.amounts = new Intl.NumberFormat(locale, {
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits,
        });
        const percent = { style: 'percent', maximumFractionDigits: 1 } as const;
        this.changes = new Intl.NumberFormat(locale, { ...percent, signDisplay: 'exceptZero' });
        this.shares = new Intl.NumberFormat(locale, percent);
        this.compacts = new Intl.NumberFormat(locale, {
            notation: 'compact',
            maximumFractionDigits: 1,
        });
        this.instants = new Intl.DateTimeFormat(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
            ...(timeZone ? { timeZone } : {}),
        });
    }

    /** An amount, with the Book's decimal places. */
    amount(value: string): string {
        return this.amounts.format(decimal(value));
    }

    /** A change ratio as a signed percentage, such as `+12.3%`. */
    change(ratio: string): string {
        return this.changes.format(decimal(ratio));
    }

    /** A share ratio as a percentage, such as `98.7%`. */
    share(ratio: string): string {
        return this.shares.format(decimal(ratio));
    }

    /** An abbreviated number for chart axes, such as `12.5K`. Display only. */
    compact(value: number): string {
        return this.compacts.format(value);
    }

    /** A `YYYY-MM` calendar month. */
    month(month: string, style: MonthStyle): string {
        let format = this.months.get(style);
        if (!format) {
            format = new Intl.DateTimeFormat(this.locale, {
                ...MONTH_OPTIONS[style],
                timeZone: 'UTC',
            });
            this.months.set(style, format);
        }
        return format.format(new Date(`${month}-01T00:00:00Z`));
    }

    /** An ISO instant, such as when balances were read. */
    instant(iso: string): string {
        return this.instants.format(new Date(iso));
    }

    /** The number a chart draws for a decimal; display only, never for totals. */
    static plot(value: string): number {
        return Number(decimal(value));
    }
}
