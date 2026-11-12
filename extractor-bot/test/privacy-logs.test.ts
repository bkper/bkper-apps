import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { Account, Book, File } from 'bkper-js';
import { ExternalExtractorClient } from '../src/external-extractor/ExternalExtractorClient.js';
import { BkperAIResponsesClient } from '../src/genai/BkperAIResponsesClient.js';
import { ExtractorAmount } from '../src/genai/ExtractorAmount.js';
import { ExtractorDate } from '../src/genai/ExtractorDate.js';
import { ExtractorInvoice } from '../src/genai/invoice/ExtractorInvoice.js';
import { ExtractorStatementCSV } from '../src/genai/statement/csv/ExtractorStatementCSV.js';
import { JaroWinklerStringComparator, PromptImprovementServiceBase, type RegressionDetail } from '../src/services/PromptImprovementServiceBase.js';

const SECRET = 'SECRET-7781';

// Captures everything the code writes to the console during a scenario.
let logged: string[] = [];
const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;

beforeEach(() => {
    logged = [];
    for (const method of methods) {
        spyOn(console, method).mockImplementation((...args: unknown[]) => {
            logged.push(args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '));
        });
    }
});

afterEach(() => {
    for (const method of methods) spyOn(console, method).mockRestore();
});

function aiClient(answer: string): BkperAIResponsesClient {
    return new BkperAIResponsesClient({
        baseUrl: 'http://localhost:8792/v1',
        oauthToken: 'token',
        fetch: Object.assign(mock(async () => Response.json({
            status: 'completed',
            output: [{ id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: answer, annotations: [] }] }],
        })), { preconnect: fetch.preconnect }),
    });
}

function file(content: string, contentType: string): File {
    return {
        getContent: async () => content,
        getContentType: () => contentType,
        getName: () => 'document',
    } as unknown as File;
}

class TestablePromptImprovement extends PromptImprovementServiceBase {
    constructor() {
        super(new JaroWinklerStringComparator());
    }

    format(details: RegressionDetail[], identifier?: string): string {
        return this.formatRegressionDetails(details, identifier);
    }
}

describe('Event-mode logs keep customer content out', () => {
    it('does not log the transaction description when extracting an amount or a date', async () => {
        await new ExtractorAmount({} as Env, aiClient('12.5')).extract(`Payment ${SECRET} of 12,50`);
        await new ExtractorDate({} as Env, aiClient('2026-11-01')).extract(`Payment ${SECRET} on 01/11/2026`);

        expect(logged.join('\n')).not.toContain(SECRET);
    });

    it('does not log the extraction prompt for documents or CSV statements', async () => {
        const invoice = new ExtractorInvoice(file('base64==', 'application/pdf'), {} as Env, aiClient('{}'));
        const csv = new ExtractorStatementCSV(file(Buffer.from('date,amount\n2026-11-01,10').toString('base64'), 'text/csv'), {} as Env, aiClient('{"transactions":[]}'));

        await invoice.extract(`Instructions ${SECRET}`).catch(() => undefined);
        await csv.extract(`Instructions ${SECRET}`).catch(() => undefined);

        expect(logged.join('\n')).not.toContain(SECRET);
    });

    it('describes regressions by field, without the extracted or expected values', () => {
        const output = new TestablePromptImprovement().format([
            { field: 'description', original: `Coffee ${SECRET}`, improved: 'Coffee', expected: `Coffee ${SECRET}` },
        ], 'Transaction #1');

        expect(output).toContain('description');
        expect(output).not.toContain(SECRET);
    });

    it('logs only the host of a customer parser URL', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mock(async () => Response.json({ success: true, data: { transaction: { date: '2026-11-01', description: 'x', amount: 1, properties: {} } } })) as unknown as typeof fetch;
        try {
            const url = `https://parser.example.com/extract?key=${SECRET}`;
            const book = { json: () => ({ id: 'book_1' }), getAccounts: async () => [] } as unknown as Book;
            const account = { getId: () => 'acc_1', getName: () => 'Bank', getVisibleProperties: () => ({}), json: () => ({ id: 'acc_1' }) } as unknown as Account;
            const parserFile = { getId: () => 'file_1', getName: () => 'invoice.pdf', getContentType: () => 'application/pdf', getContent: async () => 'base64==', json: () => ({ id: 'file_1' }) } as unknown as File;

            await new ExternalExtractorClient(url).extractTransaction(parserFile, book, account, { url, source: 'account', account });
        } finally {
            globalThis.fetch = originalFetch;
        }

        expect(logged.join('\n')).toContain('parser.example.com');
        expect(logged.join('\n')).not.toContain(SECRET);
    });
});
