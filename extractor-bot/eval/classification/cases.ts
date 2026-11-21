/**
 * Synthetic documents of the file classification trial, rendered by `documents/render.py`, with the
 * label Extractor Bot should give each: `statement` for a list of an account's transactions, which
 * becomes one draft per row, and `single_transaction` for everything else, which becomes one draft.
 */

export type Label = 'statement' | 'single_transaction';
export const LABELS: readonly Label[] = ['statement', 'single_transaction'];

/** `pdf` has a text layer, as systems export it; `scanned_pdf` has only page images. */
export type Format = 'pdf' | 'scanned_pdf' | 'image';
export const FORMATS: readonly Format[] = ['pdf', 'scanned_pdf', 'image'];

export type CaseTag =
    | 'en'
    | 'pt'
    | 'multipage'
    /** A long table of items or usage on a single-transaction document. */
    | 'many_rows'
    /** Dated rows on a single-transaction document, as a statement has. */
    | 'dated_rows'
    /** Issued by a bank, but about one transaction. */
    | 'bank_issued'
    /** A statement that also states an amount due, as a bill does. */
    | 'amount_due'
    /** A statement with only two rows. */
    | 'few_rows'
    /** A previous balance and a payment received on a bill. */
    | 'account_summary'
    /** Portuguese "fatura": a card statement or an invoice. */
    | 'fatura'
    | 'screenshot'
    | 'photo';

export interface ClassificationCase {
    id: string;
    file: string;
    format: Format;
    label: Label;
    tags: CaseTag[];
}

function statement(file: string, format: Format, tags: CaseTag[]): ClassificationCase {
    return { id: file.replace(/\.[a-z]+$/u, ''), file, format, label: 'statement', tags };
}

function single(file: string, format: Format, tags: CaseTag[]): ClassificationCase {
    return { id: file.replace(/\.[a-z]+$/u, ''), file, format, label: 'single_transaction', tags };
}

export const CASES: ClassificationCase[] = [
    statement('en-bank-statement.pdf', 'pdf', ['en']),
    statement('en-bank-statement-3-pages.pdf', 'pdf', ['en', 'multipage']),
    statement('en-bank-statement-10-pages.pdf', 'pdf', ['en', 'multipage']),
    statement('en-card-statement.pdf', 'pdf', ['en', 'amount_due']),
    statement('pt-extrato-bancario.pdf', 'pdf', ['pt']),
    statement('pt-fatura-cartao.pdf', 'pdf', ['pt', 'amount_due', 'fatura']),
    statement('en-statement-two-rows.pdf', 'pdf', ['en', 'few_rows']),
    statement('en-payment-platform-activity.pdf', 'pdf', ['en']),
    statement('en-bank-statement-scan.pdf', 'scanned_pdf', ['en']),
    statement('pt-extrato-scan.pdf', 'scanned_pdf', ['pt', 'multipage']),
    statement('en-card-statement-scan.pdf', 'scanned_pdf', ['en', 'amount_due']),
    statement('en-online-banking.png', 'image', ['en', 'screenshot']),
    statement('pt-extrato-app.jpg', 'image', ['pt', 'screenshot']),

    single('en-invoice.pdf', 'pdf', ['en']),
    single('en-invoice-timesheet.pdf', 'pdf', ['en', 'many_rows', 'dated_rows']),
    single('en-invoice-2-pages.pdf', 'pdf', ['en', 'many_rows', 'multipage']),
    single('pt-nota-fiscal.pdf', 'pdf', ['pt', 'many_rows']),
    single('pt-fatura-telefonia.pdf', 'pdf', ['pt', 'many_rows', 'dated_rows', 'fatura']),
    single('en-utility-bill.pdf', 'pdf', ['en', 'account_summary']),
    single('en-hotel-folio.pdf', 'pdf', ['en', 'dated_rows']),
    single('en-transfer-confirmation.pdf', 'pdf', ['en', 'bank_issued']),
    single('en-quote.pdf', 'pdf', ['en']),
    single('pt-boleto.pdf', 'pdf', ['pt', 'bank_issued']),
    single('en-subscription-receipt.pdf', 'pdf', ['en', 'dated_rows']),
    single('en-bank-fee-notice.pdf', 'pdf', ['en', 'bank_issued']),
    single('en-invoice-scan.pdf', 'scanned_pdf', ['en', 'many_rows']),
    single('en-receipt-scan.pdf', 'scanned_pdf', ['en']),
    single('en-utility-bill-scan.pdf', 'scanned_pdf', ['en', 'account_summary']),
    single('en-receipt-photo.jpg', 'image', ['en', 'photo']),
    single('pt-cupom-fiscal.png', 'image', ['pt', 'many_rows']),
    single('pt-comprovante-pix.png', 'image', ['pt', 'bank_issued', 'screenshot']),
    single('en-chat-payment.png', 'image', ['en', 'screenshot']),
];
