/// <reference types="@bkper/bkper-api-types" />

import { describe, it, expect, mock } from 'bun:test';
import { Account, Book, File } from 'bkper-js';
import { AppContext } from '../../src/AppContext.js';
import { AGENT_PARSER_TRANSACTION_PROPERTY, AGENT_PARSER_TRANSACTIONS_PROPERTY } from '../../src/constants.js';
import { FileParserGenAIFileProperties } from '../../src/file-parsers/FileParserGenAIFileProperties.js';
import { FileParserGenAITransaction } from '../../src/file-parsers/FileParserGenAITransaction.js';
import { FileParserGenAITransactions } from '../../src/file-parsers/FileParserGenAITransactions.js';
import { FileParserRouter } from '../../src/file-parsers/FileParserRouter.js';

function createFile(name = 'statement.pdf', contentType = 'application/pdf'): File {
    return {
        getId: () => 'file_1',
        getName: () => name,
        getContentType: () => contentType,
    } as unknown as File;
}

function createAccount(): Account {
    return {
        getId: () => 'acc_1',
        getName: () => 'Bank',
    } as unknown as Account;
}

function createBook(): Book {
    return {
        getId: () => 'book_1',
    } as unknown as Book;
}

describe('FileParsers', () => {
    it('FileParserGenAITransactions delegates single-transaction files to the invoice parser with the transaction prompt', async () => {
        const file = createFile('receipt.pdf', 'application/pdf');
        const book = createBook();
        const account = createAccount();
        const classifyExtract = mock(async (_prompt?: string) => ({ kind: 'single_transaction' as const }));
        const statementExtract = mock(async (_prompt?: string) => ({ transactions: [] }));
        const invoiceExtract = mock(async (_prompt?: string) => ({ date: '2024-01-02', description: 'Receipt', amount: -10, properties: {} }));

        const context = {
            env: {},
            createExtractorFileClassification: () => ({ extract: classifyExtract }),
            createExtractorStatementIMG: () => ({ extract: statementExtract }),
            createExtractorInvoice: () => ({ extract: invoiceExtract }),
        } as unknown as AppContext;

        const parser = new FileParserGenAITransactions(context, new FileParserGenAITransaction(context));
        const result = await parser.parse({
            book,
            file,
            account,
            transactionsPrompt: {
                prompt: 'statement prompt',
                account,
                promptEntity: account,
                sourceProperty: 'agent_prompt',
                targetProperty: AGENT_PARSER_TRANSACTIONS_PROPERTY,
            },
            transactionPrompt: {
                prompt: 'receipt prompt',
                account,
                promptEntity: account,
                sourceProperty: AGENT_PARSER_TRANSACTION_PROPERTY,
                targetProperty: AGENT_PARSER_TRANSACTION_PROPERTY,
            },
        });

        expect(classifyExtract).toHaveBeenCalledWith(undefined);
        expect(statementExtract).not.toHaveBeenCalled();
        expect(invoiceExtract).toHaveBeenCalledWith('receipt prompt');
        expect(result.kind).toBe('transaction');
        expect(result.transactions).toHaveLength(1);
        expect(result.prompt).toBe('receipt prompt');
    });

    it('FileParserGenAITransactions defaults unclear classifier results to the single transaction parser', async () => {
        const file = createFile('message-screenshot.jpg', 'image/jpeg');
        const book = createBook();
        const account = createAccount();
        const classifyExtract = mock(async (_prompt?: string) => undefined);
        const statementExtract = mock(async (_prompt?: string) => ({ transactions: [{ date: '2024-01-01', description: 'Wrong statement row', amount: -20, properties: {} }] }));
        const invoiceExtract = mock(async (_prompt?: string) => ({ date: null, description: 'Message payment', amount: 140, properties: {} }));

        const context = {
            env: {},
            createExtractorFileClassification: () => ({ extract: classifyExtract }),
            createExtractorStatementIMG: () => ({ extract: statementExtract }),
            createExtractorInvoice: () => ({ extract: invoiceExtract }),
        } as unknown as AppContext;

        const parser = new FileParserGenAITransactions(context, new FileParserGenAITransaction(context));
        const result = await parser.parse({
            book,
            file,
            account,
            transactionsPrompt: {
                prompt: 'statement prompt',
                account,
                promptEntity: account,
                sourceProperty: AGENT_PARSER_TRANSACTIONS_PROPERTY,
                targetProperty: AGENT_PARSER_TRANSACTIONS_PROPERTY,
            },
        });

        expect(classifyExtract).toHaveBeenCalledWith(undefined);
        expect(statementExtract).not.toHaveBeenCalled();
        expect(invoiceExtract).toHaveBeenCalledWith('statement prompt');
        expect(result.kind).toBe('transaction');
        expect(result.transactions[0].description).toBe('Message payment');
    });

    it('FileParserGenAITransactions keeps purpose-specific transactions prompts on the statement parser path when classified as statement', async () => {
        const file = createFile('statement.pdf', 'application/pdf');
        const book = createBook();
        const account = createAccount();
        const classifyExtract = mock(async (_prompt?: string) => ({ kind: 'statement' as const }));
        const statementExtract = mock(async (_prompt?: string) => ({
            transactions: [{ date: '2024-01-01', description: 'Statement row', amount: -20, properties: {} }],
        }));
        const invoiceExtract = mock(async (_prompt?: string) => ({ date: '2024-01-02', description: 'Receipt', amount: -10, properties: {} }));

        const context = {
            env: {},
            createExtractorFileClassification: () => ({ extract: classifyExtract }),
            createExtractorStatementIMG: () => ({ extract: statementExtract }),
            createExtractorInvoice: () => ({ extract: invoiceExtract }),
        } as unknown as AppContext;

        const parser = new FileParserGenAITransactions(context, new FileParserGenAITransaction(context));
        const result = await parser.parse({
            book,
            file,
            account,
            transactionsPrompt: {
                prompt: 'statement prompt',
                account,
                promptEntity: account,
                sourceProperty: AGENT_PARSER_TRANSACTIONS_PROPERTY,
                targetProperty: AGENT_PARSER_TRANSACTIONS_PROPERTY,
            },
        });

        expect(classifyExtract).toHaveBeenCalledWith(undefined);
        expect(statementExtract).toHaveBeenCalledWith('statement prompt');
        expect(invoiceExtract).not.toHaveBeenCalled();
        expect(result.kind).toBe('transactions');
        expect(result.transactions).toHaveLength(1);
        expect(result.prompt).toBe('statement prompt');
    });

    it('FileParserRouter does not bypass statement classification just because a transaction prompt is configured', async () => {
        const file = createFile('statement.pdf', 'application/pdf');
        const book = createBook();
        const account = createAccount();
        const classifyExtract = mock(async (_prompt?: string) => ({ kind: 'statement' as const }));
        const statementExtract = mock(async (_prompt?: string) => ({
            transactions: [{ date: '2024-01-01', description: 'Statement row', amount: -20, properties: {} }],
        }));
        const invoiceExtract = mock(async (_prompt?: string) => ({ date: '2024-01-02', description: 'Receipt', amount: -10, properties: {} }));

        const promptContext = {
            account,
            getPrompt: (purpose: string) => {
                if (purpose === 'transaction') {
                    return {
                        prompt: 'receipt prompt',
                        account,
                        promptEntity: account,
                        sourceProperty: AGENT_PARSER_TRANSACTION_PROPERTY,
                        targetProperty: AGENT_PARSER_TRANSACTION_PROPERTY,
                    };
                }
                if (purpose === 'transactions') {
                    return {
                        account,
                        promptEntity: account,
                        targetProperty: AGENT_PARSER_TRANSACTIONS_PROPERTY,
                    };
                }
                return { targetProperty: 'agent_parser_file' };
            },
        };

        const context = {
            env: {},
            promptLookupService: {
                lookupPrompts: mock(async () => promptContext),
                lookupParserUrl: mock(async () => null),
            },
            createExtractorFileClassification: () => ({ extract: classifyExtract }),
            createExtractorStatementIMG: () => ({ extract: statementExtract }),
            createExtractorInvoice: () => ({ extract: invoiceExtract }),
        } as unknown as AppContext;

        const result = await new FileParserRouter(context).parse(book, file);

        expect(classifyExtract).toHaveBeenCalledWith(undefined);
        expect(statementExtract).toHaveBeenCalledWith(undefined);
        expect(invoiceExtract).not.toHaveBeenCalled();
        expect(result.kind).toBe('transactions');
        expect(result.transactions).toHaveLength(1);
    });

    it('does not require the local Gemini key for quota-backed Flash-only parsing', async () => {
        const file = createFile('statement.csv', 'text/csv');
        const book = createBook();
        const csvExtract = mock(async () => ({ transactions: [] }));
        const invoiceExtract = mock(async () => ({ date: null, description: 'Invoice', amount: 10, properties: {} }));
        const propertiesExtract = mock(async () => ({ properties: { issuer: 'Bank' } }));
        const context = {
            env: {},
            createExtractorStatementCSV: () => ({ extract: csvExtract }),
            createExtractorInvoice: () => ({ extract: invoiceExtract }),
            createExtractorFileProperties: () => ({ extract: propertiesExtract }),
        } as unknown as AppContext;

        await expect(new FileParserGenAITransactions(
            context,
            new FileParserGenAITransaction(context)
        ).parse({ book, file })).resolves.toMatchObject({ kind: 'transactions' });
        await expect(new FileParserGenAITransaction(context).parse({
            book,
            file: createFile('invoice.pdf'),
        })).resolves.toMatchObject({ kind: 'transaction' });
        await expect(new FileParserGenAIFileProperties(context).parse({
            book,
            file: createFile('invoice.pdf'),
        })).resolves.toEqual({ issuer: 'Bank' });
    });

    it('classifies files through Bkper AI without a local Gemini key', async () => {
        const classifyExtract = mock(async () => ({ kind: 'single_transaction' as const }));
        const invoiceExtract = mock(async () => ({
            date: null,
            description: 'Invoice',
            amount: 10,
            properties: {},
        }));
        const context = {
            env: {},
            createExtractorFileClassification: () => ({ extract: classifyExtract }),
            createExtractorInvoice: () => ({ extract: invoiceExtract }),
        } as unknown as AppContext;
        const parser = new FileParserGenAITransactions(
            context,
            new FileParserGenAITransaction(context)
        );

        await expect(parser.parse({
            book: createBook(),
            file: createFile('statement.pdf'),
        })).resolves.toMatchObject({ kind: 'transaction' });
        expect(classifyExtract).toHaveBeenCalledWith(undefined);
    });

    it('FileParserGenAIFileProperties filters internal file properties and stringifies scalar values', async () => {
        const file = createFile('statement.pdf', 'application/pdf');
        const book = createBook();
        const extract = mock(async (_prompt?: string) => ({
            properties: {
                statement_period: '2024-01',
                page_count: 3,
                agent_internal: 'hidden',
                parsed_total: 'hidden',
                account_id: 'hidden',
                group_id: 'hidden',
                upload_method: 'hidden',
                auto_filled_date_value: 'hidden',
                transactions_summary: 'agent-owned',
                empty_value: '',
            },
        }));

        const context = {
            env: {},
            createExtractorFileProperties: () => ({ extract }),
        } as unknown as AppContext;

        const parser = new FileParserGenAIFileProperties(context);
        const result = await parser.parse({ book, file, prompt: 'metadata prompt' });

        expect(extract).toHaveBeenCalledWith('metadata prompt');
        expect(result).toEqual({ statement_period: '2024-01', page_count: '3' });
    });
});
