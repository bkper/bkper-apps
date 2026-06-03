import { describe, expect, it } from 'bun:test';
import { defaultExportOptions } from '../src/export-config';
import { configureTransactionsDataTableBuilder, type TransactionsDataTableBuilderLike } from '../src/export-builder';

class RecordingBuilder implements TransactionsDataTableBuilderLike {
    readonly calls: Array<[string, boolean]> = [];

    formatDates(format: boolean): this {
        this.calls.push(['formatDates', format]);
        return this;
    }

    formatValues(format: boolean): this {
        this.calls.push(['formatValues', format]);
        return this;
    }

    recordedAt(include: boolean): this {
        this.calls.push(['recordedAt', include]);
        return this;
    }

    ids(include: boolean): this {
        this.calls.push(['ids', include]);
        return this;
    }

    properties(include: boolean): this {
        this.calls.push(['properties', include]);
        return this;
    }

    hiddenProperties(include: boolean): this {
        this.calls.push(['hiddenProperties', include]);
        return this;
    }

    urls(include: boolean): this {
        this.calls.push(['urls', include]);
        return this;
    }
}

describe('transaction data table builder configuration', () => {
    it('applies export options to the Bkper transactions data table builder', () => {
        const builder = new RecordingBuilder();

        configureTransactionsDataTableBuilder(builder, {
            ...defaultExportOptions,
            includeIds: true,
            includeProperties: true,
            includeHiddenProperties: true,
            includeUrls: true,
        });

        expect(builder.calls).toEqual([
            ['formatDates', true],
            ['formatValues', true],
            ['recordedAt', true],
            ['ids', true],
            ['properties', true],
            ['hiddenProperties', true],
            ['urls', true],
        ]);
    });

    it('does not pass hidden properties when properties are disabled', () => {
        const builder = new RecordingBuilder();

        configureTransactionsDataTableBuilder(builder, {
            ...defaultExportOptions,
            includeProperties: false,
            includeHiddenProperties: true,
        });

        expect(builder.calls).toContainEqual(['properties', false]);
        expect(builder.calls).toContainEqual(['hiddenProperties', false]);
    });
});
