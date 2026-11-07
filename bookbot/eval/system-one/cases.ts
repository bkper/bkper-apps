/**
 * Synthetic discovery cases. Every Book, Account, merchant and person here is invented.
 *
 * Each case is a bank line on a known bank Account, as discovery receives it: one Account side is
 * known and the other must be found. `expected` is the Account a bookkeeper would pick, or null when
 * no Account of the Book fits and discovery should leave the draft without a suggestion.
 */

export type AccountType = 'ASSET' | 'LIABILITY' | 'INCOMING' | 'OUTGOING';

export interface CandidateAccount {
    name: string;
    type: AccountType;
    group: string;
}

export interface SyntheticBook {
    name: string;
    bankAccount: string;
    accounts: CandidateAccount[];
}

export type CaseTag = 'clear' | 'ambiguous' | 'none_fits' | 'multilingual' | 'noisy';

export interface DiscoveryCase {
    id: string;
    book: SyntheticBook;
    direction: 'in' | 'out';
    amount: string;
    description: string;
    expected: string | null;
    tags: CaseTag[];
}

const ACME_LABS: SyntheticBook = {
    name: 'Acme Labs (synthetic US software company)',
    bankAccount: 'Chase Checking',
    accounts: [
        { name: 'Software Subscriptions', type: 'OUTGOING', group: 'Operating Expenses' },
        { name: 'Cloud Hosting', type: 'OUTGOING', group: 'Operating Expenses' },
        { name: 'Travel', type: 'OUTGOING', group: 'Operating Expenses' },
        { name: 'Meals & Entertainment', type: 'OUTGOING', group: 'Operating Expenses' },
        { name: 'Payroll', type: 'OUTGOING', group: 'Personnel' },
        { name: 'Contractors', type: 'OUTGOING', group: 'Personnel' },
        { name: 'Office Rent', type: 'OUTGOING', group: 'Facilities' },
        { name: 'Utilities', type: 'OUTGOING', group: 'Facilities' },
        { name: 'Advertising', type: 'OUTGOING', group: 'Marketing' },
        { name: 'Bank Fees', type: 'OUTGOING', group: 'Financial' },
        { name: 'Subscription Revenue', type: 'INCOMING', group: 'Revenue' },
        { name: 'Consulting Revenue', type: 'INCOMING', group: 'Revenue' },
        { name: 'Interest Income', type: 'INCOMING', group: 'Financial' },
        { name: 'Amex Card', type: 'LIABILITY', group: 'Credit Cards' },
        { name: 'Sales Tax Payable', type: 'LIABILITY', group: 'Taxes' },
        { name: 'Savings', type: 'ASSET', group: 'Bank Accounts' },
    ],
};

const PADARIA: SyntheticBook = {
    name: 'Padaria Pão Quente (synthetic Brazilian bakery)',
    bankAccount: 'Itaú Conta Corrente',
    accounts: [
        { name: 'Fornecedores de Farinha', type: 'OUTGOING', group: 'Custo das Mercadorias' },
        { name: 'Laticínios', type: 'OUTGOING', group: 'Custo das Mercadorias' },
        { name: 'Energia Elétrica', type: 'OUTGOING', group: 'Despesas Fixas' },
        { name: 'Aluguel', type: 'OUTGOING', group: 'Despesas Fixas' },
        { name: 'Internet e Telefone', type: 'OUTGOING', group: 'Despesas Fixas' },
        { name: 'Salários', type: 'OUTGOING', group: 'Pessoal' },
        { name: 'Manutenção de Equipamentos', type: 'OUTGOING', group: 'Despesas Operacionais' },
        { name: 'Impostos - Simples Nacional', type: 'OUTGOING', group: 'Impostos' },
        { name: 'Tarifas Bancárias', type: 'OUTGOING', group: 'Despesas Financeiras' },
        { name: 'Vendas no Balcão', type: 'INCOMING', group: 'Receitas' },
        { name: 'Vendas iFood', type: 'INCOMING', group: 'Receitas' },
        { name: 'Recebimentos Cartão', type: 'INCOMING', group: 'Receitas' },
        { name: 'Empréstimo BNDES', type: 'LIABILITY', group: 'Empréstimos' },
    ],
};

const PERSONAL: SyntheticBook = {
    name: 'Ana personal finances (synthetic, English Accounts, Brazilian bank)',
    bankAccount: 'Nubank Checking',
    accounts: [
        { name: 'Groceries', type: 'OUTGOING', group: 'Living' },
        { name: 'Restaurants', type: 'OUTGOING', group: 'Living' },
        { name: 'Transport', type: 'OUTGOING', group: 'Living' },
        { name: 'Housing', type: 'OUTGOING', group: 'Home' },
        { name: 'Health', type: 'OUTGOING', group: 'Personal Care' },
        { name: 'Gym', type: 'OUTGOING', group: 'Personal Care' },
        { name: 'Streaming', type: 'OUTGOING', group: 'Leisure' },
        { name: 'Salary', type: 'INCOMING', group: 'Income' },
        { name: 'Freelance Income', type: 'INCOMING', group: 'Income' },
        { name: 'Nubank Credit Card', type: 'LIABILITY', group: 'Credit Cards' },
        { name: 'Investments', type: 'ASSET', group: 'Savings' },
    ],
};

export const CASES: DiscoveryCase[] = [
    { id: 'acme-github', book: ACME_LABS, direction: 'out', amount: 'USD 84.00', description: 'GITHUB, INC. GITHUB.COM CA 2291', expected: 'Software Subscriptions', tags: ['clear', 'noisy'] },
    { id: 'acme-aws', book: ACME_LABS, direction: 'out', amount: 'USD 1,243.17', description: 'AWS EMEA aws.amazon.co WA', expected: 'Cloud Hosting', tags: ['clear', 'noisy'] },
    { id: 'acme-gusto', book: ACME_LABS, direction: 'out', amount: 'USD 48,210.55', description: 'GUSTO PAYROLL 2291 NET PAY ACME LABS', expected: 'Payroll', tags: ['clear'] },
    { id: 'acme-upwork', book: ACME_LABS, direction: 'out', amount: 'USD 2,400.00', description: 'UPWORK -ESCROW 88412 A-88412', expected: 'Contractors', tags: ['clear', 'noisy'] },
    { id: 'acme-wework', book: ACME_LABS, direction: 'out', amount: 'USD 3,500.00', description: 'WEWORK 1 MARKET ST MEMBERSHIP', expected: 'Office Rent', tags: ['ambiguous'] },
    { id: 'acme-united', book: ACME_LABS, direction: 'out', amount: 'USD 612.30', description: 'UNITED 0162345678901 HOUSTON TX', expected: 'Travel', tags: ['clear', 'noisy'] },
    { id: 'acme-coffee', book: ACME_LABS, direction: 'out', amount: 'USD 38.50', description: 'SQ *BLUE BOTTLE COFFEE OAKLAND', expected: 'Meals & Entertainment', tags: ['noisy'] },
    { id: 'acme-google-ads', book: ACME_LABS, direction: 'out', amount: 'USD 1,500.00', description: 'GOOGLE *ADS4471-2291 CC@GOOGLE.COM', expected: 'Advertising', tags: ['ambiguous', 'noisy'] },
    { id: 'acme-stripe', book: ACME_LABS, direction: 'in', amount: 'USD 12,840.22', description: 'STRIPE TRANSFER ST-A1B2C3D4 ACME LABS', expected: 'Subscription Revenue', tags: ['clear', 'noisy'] },
    { id: 'acme-wire-in', book: ACME_LABS, direction: 'in', amount: 'USD 9,000.00', description: 'WIRE IN ORIG: GLOBEX CORP REF INV-2291 ADVISORY SVCS', expected: 'Consulting Revenue', tags: ['clear'] },
    { id: 'acme-amex', book: ACME_LABS, direction: 'out', amount: 'USD 5,870.00', description: 'AMEX EPAYMENT ACH PMT W4412', expected: 'Amex Card', tags: ['clear', 'noisy'] },
    { id: 'acme-cdtfa', book: ACME_LABS, direction: 'out', amount: 'USD 1,830.00', description: 'CA DEPT TAX FEE CDTFA EPMT 0045', expected: 'Sales Tax Payable', tags: ['ambiguous', 'noisy'] },
    { id: 'acme-peloton', book: ACME_LABS, direction: 'out', amount: 'USD 44.00', description: 'PELOTON* MEMBERSHIP', expected: null, tags: ['none_fits'] },
    { id: 'acme-check', book: ACME_LABS, direction: 'out', amount: 'USD 750.00', description: 'CHECK 1043', expected: null, tags: ['none_fits', 'ambiguous'] },
    { id: 'acme-legalzoom', book: ACME_LABS, direction: 'out', amount: 'USD 299.00', description: 'LEGALZOOM*ANNUAL REPORT FILING', expected: null, tags: ['none_fits'] },

    { id: 'padaria-moinho', book: PADARIA, direction: 'out', amount: 'BRL 3.200,00', description: 'PIX ENVIADO MOINHO SAO JORGE LTDA', expected: 'Fornecedores de Farinha', tags: ['clear', 'multilingual'] },
    { id: 'padaria-laticinios', book: PADARIA, direction: 'out', amount: 'BRL 1.450,80', description: 'BOLETO PAGO LATICINIOS SERRA AZUL', expected: 'Laticínios', tags: ['clear', 'multilingual'] },
    { id: 'padaria-enel', book: PADARIA, direction: 'out', amount: 'BRL 980,15', description: 'DEB AUTOMATICO ENEL SP 0045521', expected: 'Energia Elétrica', tags: ['clear', 'multilingual', 'noisy'] },
    { id: 'padaria-das', book: PADARIA, direction: 'out', amount: 'BRL 2.115,42', description: 'DAS SIMPLES NACIONAL 10/2026', expected: 'Impostos - Simples Nacional', tags: ['clear', 'multilingual'] },
    { id: 'padaria-tarifa', book: PADARIA, direction: 'out', amount: 'BRL 59,90', description: 'TAR PACOTE SERVICOS', expected: 'Tarifas Bancárias', tags: ['multilingual', 'noisy'] },
    { id: 'padaria-cielo', book: PADARIA, direction: 'in', amount: 'BRL 7.842,10', description: 'CIELO VENDAS CRED 31/10', expected: 'Recebimentos Cartão', tags: ['clear', 'multilingual', 'noisy'] },
    { id: 'padaria-ifood', book: PADARIA, direction: 'in', amount: 'BRL 2.301,55', description: 'IFOOD.COM AGENCIA REPASSE', expected: 'Vendas iFood', tags: ['clear', 'multilingual'] },
    { id: 'padaria-deposito', book: PADARIA, direction: 'in', amount: 'BRL 1.120,00', description: 'DEP DINHEIRO CAIXA ESTAB', expected: 'Vendas no Balcão', tags: ['ambiguous', 'multilingual', 'noisy'] },
    { id: 'padaria-vivo', book: PADARIA, direction: 'out', amount: 'BRL 149,99', description: 'VIVO FIBRA DEB AUT', expected: 'Internet e Telefone', tags: ['clear', 'multilingual'] },
    { id: 'padaria-tecnico', book: PADARIA, direction: 'out', amount: 'BRL 650,00', description: 'PIX ENVIADO JOAO TECNICO FORNOS', expected: 'Manutenção de Equipamentos', tags: ['ambiguous', 'multilingual'] },
    { id: 'padaria-netflix', book: PADARIA, direction: 'out', amount: 'BRL 55,90', description: 'NETFLIX.COM', expected: null, tags: ['none_fits'] },
    { id: 'padaria-uber', book: PADARIA, direction: 'out', amount: 'BRL 32,40', description: 'UBER *TRIP HELP.UBER.COM', expected: null, tags: ['none_fits', 'noisy'] },

    { id: 'personal-paodeacucar', book: PERSONAL, direction: 'out', amount: 'BRL 412,37', description: 'Compra no debito - PAO DE ACUCAR 1234', expected: 'Groceries', tags: ['clear', 'multilingual'] },
    { id: 'personal-ifood', book: PERSONAL, direction: 'out', amount: 'BRL 68,90', description: 'Compra no debito - IFD*RESTAURANTE SABOR', expected: 'Restaurants', tags: ['multilingual', 'noisy'] },
    { id: 'personal-99', book: PERSONAL, direction: 'out', amount: 'BRL 27,50', description: 'Pix enviado - 99 TECNOLOGIA LTDA', expected: 'Transport', tags: ['ambiguous', 'multilingual', 'noisy'] },
    { id: 'personal-salario', book: PERSONAL, direction: 'in', amount: 'BRL 8.900,00', description: 'Transferencia recebida - EMPRESA XYZ LTDA SALARIO', expected: 'Salary', tags: ['clear', 'multilingual'] },
    { id: 'personal-fatura', book: PERSONAL, direction: 'out', amount: 'BRL 3.204,11', description: 'Pagamento de fatura', expected: 'Nubank Credit Card', tags: ['clear', 'multilingual'] },
    { id: 'personal-rdb', book: PERSONAL, direction: 'out', amount: 'BRL 1.000,00', description: 'Aplicacao RDB', expected: 'Investments', tags: ['multilingual', 'noisy'] },
    { id: 'personal-drogasil', book: PERSONAL, direction: 'out', amount: 'BRL 89,40', description: 'DROGASIL 0451 SAO PAULO BR', expected: 'Health', tags: ['clear', 'noisy'] },
    { id: 'personal-smartfit', book: PERSONAL, direction: 'out', amount: 'BRL 119,90', description: 'SMARTFIT MENSALIDADE', expected: 'Gym', tags: ['clear', 'multilingual'] },
    { id: 'personal-condominio', book: PERSONAL, direction: 'out', amount: 'BRL 780,00', description: 'Boleto - CONDOMINIO ED. AURORA', expected: 'Housing', tags: ['clear', 'multilingual'] },
    { id: 'personal-pix-maria', book: PERSONAL, direction: 'in', amount: 'BRL 150,00', description: 'Pix recebido - Maria Souza', expected: null, tags: ['none_fits', 'ambiguous', 'multilingual'] },
    { id: 'personal-cobasi', book: PERSONAL, direction: 'out', amount: 'BRL 236,80', description: 'COBASI PET SHOP 0087', expected: null, tags: ['none_fits', 'noisy'] },
];
