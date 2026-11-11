/**
 * Synthetic invoices, receipts and emails. Every business, person, number and address is invented.
 *
 * `expected` holds what a bookkeeper would read from each document. A field is null when the
 * document does not state it, and a model that fills it in is hallucinating. Item amounts, charges
 * and discounts are what the document itemizes; when it itemizes, they add up to the total.
 */

export type CaseTag =
    | 'en'
    | 'pt'
    | 'invoice'
    | 'receipt'
    | 'email'
    | 'image'
    | 'messy'
    | 'missing_fields'
    | 'distractor_dates'
    | 'yearless_date'
    | 'number_format';

export interface ExpectedFields {
    /** YYYY-MM-DD; year-less dates resolve against REFERENCE_DATE. */
    date: string | null;
    total: number | null;
    /** ISO 4217 code, null when the document states no currency. */
    currency: string | null;
    /** Accepted names; an answer containing any of them is correct. */
    supplier: string[] | null;
    /** Accepted numbers, compared on letters and digits only. */
    documentNumber: string[] | null;
    /** Keywords; a description containing any of them is correct. */
    description: string[];
    /** Item amounts in document order; empty when the document does not itemize. */
    lineAmounts: number[];
    /** Taxes, shipping, fees and tips added to the items. */
    charges: number[];
    /** Discounts, as positive amounts. */
    discounts: number[];
}

export interface ImageDocument {
    /** File name in `images/`, rendered by `images/render.py`. */
    file: string;
    format: 'png' | 'jpeg';
}

export interface ExtractionCase {
    id: string;
    tags: CaseTag[];
    /**
     * Who paid or was billed: the Book's owner, whom Extractor Bot knows from the Book. The
     * English documents belong to a design studio's Book, the Portuguese ones to a bakery's, except
     * where the document names another payer.
     */
    buyer: string;
    /** The document as plain text, for text documents. */
    text?: string;
    /** The document as an image, for scanned documents. */
    image?: ImageDocument;
    expected: ExpectedFields;
}

/** The day the trial pretends to run; year-less dates in the documents fall in its year. */
export const REFERENCE_DATE = '2026-10-31';

const NO_ITEMS = { lineAmounts: [], charges: [], discounts: [] };

export const CASES: ExtractionCase[] = [
    {
        id: 'en-invoice-office-supply',
        tags: ['en', 'invoice'],
        buyer: 'Tern & Finch Design LLC',
        text: `BLUEPEAK OFFICE SUPPLY INC.
1440 Harbor Way, Oakland CA 94607

INVOICE
Invoice No: BP-40417
Invoice Date: 2026-09-14
Due Date: 2026-10-14
Bill To: Tern & Finch Design LLC

Description                    Qty   Unit Price   Amount
Copy paper A4, box of 10         3       42.00     126.00
Toner cartridge HX-220           2       89.50     179.00
Desk organizer, bamboo           1       24.90      24.90

Subtotal                                         329.90
Sales tax 8.25%                                   27.22
TOTAL DUE (USD)                                  357.12
`,
        expected: {
            date: '2026-09-14',
            total: 357.12,
            currency: 'USD',
            supplier: ['Bluepeak Office Supply'],
            documentNumber: ['BP-40417'],
            description: ['paper', 'toner', 'office supplies', 'organizer'],
            lineAmounts: [126, 179, 24.9],
            charges: [27.22],
            discounts: [],
        },
    },
    {
        id: 'en-receipt-coffee',
        tags: ['en', 'receipt', 'messy'],
        buyer: 'Tern & Finch Design LLC',
        text: `  ** HALFMOON COFFEE ROASTERS **
   88 Linden St  Portland OR
  TEL 503-555-0144
--------------------------------
CHK 7781        10/02/2026 08:14AM
SRV: JAY      TBL 4
--------------------------------
1 OAT LATTE 16OZ          $5.75
1 CROISSANT ALMOND        $4.25
2 DRIP COFFEE @2.90       $5.80
--------------------------------
SUBTOTAL                 $15.80
TAX                       $0.00
TIP                       $3.00
TOTAL                    $18.80
VISA ****1182   APPROVED
THANK YOU!! come again
`,
        expected: {
            date: '2026-10-02',
            total: 18.8,
            currency: 'USD',
            supplier: ['Halfmoon Coffee'],
            documentNumber: ['7781', 'CHK 7781'],
            description: ['latte', 'coffee', 'croissant'],
            lineAmounts: [5.75, 4.25, 5.8],
            charges: [3],
            discounts: [],
        },
    },
    {
        id: 'en-email-saas-receipt',
        tags: ['en', 'email', 'receipt'],
        buyer: 'Tern & Finch Design LLC',
        text: `From: Lumora Cloud <billing@lumora.example>
To: ops@ternfinch.example
Subject: Your receipt from Lumora Cloud #2391-4410
Date: Sat, 3 Oct 2026 09:12:44 +0000

Hi there,

Thanks for your payment. Here is your receipt.

Receipt number   2391-4410
Date paid        October 3, 2026
Payment method   Mastercard - 5521

Lumora Cloud Pro (monthly)     Oct 3 – Nov 3, 2026     $49.00
Amount paid                                             $49.00

Questions? Reply to this email.
`,
        expected: {
            date: '2026-10-03',
            total: 49,
            currency: 'USD',
            supplier: ['Lumora Cloud'],
            documentNumber: ['2391-4410'],
            description: ['lumora', 'cloud pro', 'subscription', 'plan'],
            lineAmounts: [49],
            charges: [],
            discounts: [],
        },
    },
    {
        id: 'en-utility-bill',
        tags: ['en', 'invoice', 'distractor_dates', 'messy'],
        buyer: 'Tern & Finch Design LLC',
        text: `CASCADE POWER & LIGHT
Bill no. CPL-552019          Statement date: 09/28/2026
Account 0049-221-87
Service address: 220 Alder Ave Apt 3, Eugene OR

Billing period 08/27/2026 - 09/26/2026
Previous balance              $112.40
Payment received 09/05 - thank you   -$112.40
Electric service 612 kWh       $86.71
Base charge                    $12.00
Public purpose charge           $2.61
Amount due                    $101.32
Due by 10/19/2026

Pay online at cascadepower.example
`,
        expected: {
            date: '2026-09-28',
            total: 101.32,
            currency: 'USD',
            supplier: ['Cascade Power'],
            documentNumber: ['CPL-552019'],
            description: ['electric', 'power', 'energy', 'utility'],
            lineAmounts: [86.71, 12, 2.61],
            charges: [],
            discounts: [],
        },
    },
    {
        id: 'en-contractor-invoice',
        tags: ['en', 'invoice', 'number_format'],
        buyer: 'Tern & Finch Design LLC',
        text: `Invoice #0042
From: Marisol Okafor — Illustration & Layout
To: Tern & Finch Design LLC
Issued 1 September 2026

Services, August 2026
- Book cover illustration, final art .......... 1,200.00
- Interior layout, 18 hours x 45.00 ........... 810.00
- Rush fee .................................... 150.00

Total ........................................ 2,160.00 USD
Payment by bank transfer within 15 days.
`,
        expected: {
            date: '2026-09-01',
            total: 2160,
            currency: 'USD',
            supplier: ['Marisol Okafor'],
            documentNumber: ['0042', '42'],
            description: ['illustration', 'layout', 'cover', 'design'],
            lineAmounts: [1200, 810, 150],
            charges: [],
            discounts: [],
        },
    },
    {
        id: 'en-email-no-amount',
        tags: ['en', 'email', 'missing_fields'],
        buyer: 'Tern & Finch Design LLC',
        text: `Subject: September consulting invoice
From: Priya Raman <priya@ramanadvisory.example>

Hi Tom,

Please find attached my invoice for the September consulting work
(strategy workshops and follow-up calls). Let me know if anything
needs changing.

Best,
Priya
Raman Advisory
`,
        expected: {
            date: null,
            total: null,
            currency: null,
            supplier: ['Raman Advisory', 'Priya Raman'],
            documentNumber: null,
            description: ['consulting', 'workshop', 'strategy'],
            ...NO_ITEMS,
        },
    },
    {
        id: 'en-email-reminder-no-date',
        tags: ['en', 'email', 'missing_fields'],
        buyer: 'Tern & Finch Design LLC',
        text: `Hello,

Just a friendly reminder that invoice FW-1187 for the spring garden
cleanup is still open. The balance is $640.00.

You can pay by check or Zelle.

Thanks,
Fernwood Landscaping
`,
        expected: {
            date: null,
            total: 640,
            currency: 'USD',
            supplier: ['Fernwood Landscaping'],
            documentNumber: ['FW-1187'],
            description: ['garden', 'cleanup', 'landscaping'],
            ...NO_ITEMS,
        },
    },
    {
        id: 'en-hotel-folio',
        tags: ['en', 'invoice', 'distractor_dates'],
        buyer: 'Tern & Finch Design LLC',
        text: `THE GRANARY HOTEL — GUEST FOLIO
Folio 55102          Room 214
Guest: S. Whitfield
Arrival 21-Sep-2026   Departure 23-Sep-2026

21-Sep  Room charge                 189.00
21-Sep  Room service                 36.50
22-Sep  Room charge                 189.00
22-Sep  Corporate rate discount     -37.80
23-Sep  City occupancy tax           42.12

Balance due USD                     418.82
Paid AMEX 23-Sep-2026
`,
        expected: {
            date: '2026-09-23',
            total: 418.82,
            currency: 'USD',
            supplier: ['Granary Hotel'],
            documentNumber: ['55102'],
            description: ['hotel', 'room', 'stay', 'lodging', 'accommodation'],
            lineAmounts: [189, 36.5, 189],
            charges: [42.12],
            discounts: [37.8],
        },
    },
    {
        id: 'en-uk-bookshop',
        tags: ['en', 'receipt'],
        buyer: 'Tern & Finch Design LLC',
        text: `Pickwick & Lane Booksellers
12 Market Row, York YO1 8AB
VAT Reg GB 284 1192 07

04/09/2026  15:42   Till 2   Receipt 3318-22

The Kitchen Garden (hb)        £22.00
Atlas of Rivers (pb)           £14.99
Gift wrap                       £1.50

TOTAL                          £38.49
Card                           £38.49
VAT included @0% books / 20% other
`,
        expected: {
            date: '2026-09-04',
            total: 38.49,
            currency: 'GBP',
            supplier: ['Pickwick & Lane'],
            documentNumber: ['3318-22'],
            description: ['book', 'livro'],
            lineAmounts: [22, 14.99, 1.5],
            charges: [],
            discounts: [],
        },
    },
    {
        id: 'en-order-email',
        tags: ['en', 'email', 'invoice'],
        buyer: 'Tern & Finch Design LLC',
        text: `Subject: Your Parcelwise order #PW-88310-27 has shipped

Order placed: September 29, 2026
Sold by: Parcelwise Marketplace

Items in this shipment
  USB-C hub, 7-in-1            1 x $34.99      $34.99
  Laptop stand, aluminium      1 x $27.50      $27.50
  HDMI cable 2m                2 x $8.00       $16.00

Item subtotal:     $78.49
Shipping:           $5.99
Promotion applied: -$10.00
Estimated tax:      $6.05
Order total:       $80.53
`,
        expected: {
            date: '2026-09-29',
            total: 80.53,
            currency: 'USD',
            supplier: ['Parcelwise'],
            documentNumber: ['PW-88310-27'],
            description: ['usb', 'hub', 'laptop', 'hdmi', 'accessories', 'electronics'],
            lineAmounts: [34.99, 27.5, 16],
            charges: [5.99, 6.05],
            discounts: [10],
        },
    },
    {
        id: 'en-eur-tools-invoice',
        tags: ['en', 'invoice', 'number_format'],
        buyer: 'Tern & Finch Design LLC',
        text: `Kranich Werkzeuge GmbH · Hafenstraße 9 · 20457 Hamburg
USt-IdNr. DE 318 204 551

INVOICE  RE-2026-1093
Date: 17.09.2026
Customer: Tern & Finch Design LLC

Pos  Item                         Qty    Price      Total
1    Cordless drill KX-18          1   249,00 €   249,00 €
2    Drill bit set, 32 pcs         2    35,50 €    71,00 €

Net amount                                      320,00 €
VAT 19 %                                         60,80 €
Invoice total                                   380,80 €
`,
        expected: {
            date: '2026-09-17',
            total: 380.8,
            currency: 'EUR',
            supplier: ['Kranich Werkzeuge'],
            documentNumber: ['RE-2026-1093'],
            description: ['drill', 'tool'],
            lineAmounts: [249, 71],
            charges: [60.8],
            discounts: [],
        },
    },
    {
        id: 'en-fuel-ocr',
        tags: ['en', 'receipt', 'messy', 'missing_fields'],
        buyer: 'Tern & Finch Design LLC',
        text: `QU1CKST0P FUEL #0218
H1GHWAY 9 & ELM
DATE 10/11/26  TIME l7:O3
PUMP# 06  REG UNL
GALL0NS 11.204
PRICE/GAL $3.459
FUEL SALE    $38.75
  T0TAL      $38.75
DEBIT       $38.75
AUTH 0O4471
`,
        expected: {
            date: '2026-10-11',
            total: 38.75,
            currency: 'USD',
            supplier: ['Quickstop Fuel', 'QU1CKST0P FUEL'],
            documentNumber: null,
            description: ['fuel', 'gas', 'unleaded', 'combustivel'],
            lineAmounts: [38.75],
            charges: [],
            discounts: [],
        },
    },
    {
        id: 'en-lunch-no-year',
        tags: ['en', 'receipt', 'yearless_date', 'missing_fields'],
        buyer: 'Tern & Finch Design LLC',
        text: `Saffron Table
Lunch — Oct 22
Table 9 · Guests 3

Lamb biryani        $18.00
Paneer tikka        $15.50
Mango lassi x3      $13.50
Subtotal            $47.00
Service 18%          $8.46
Total               $55.46
`,
        expected: {
            date: '2026-10-22',
            total: 55.46,
            currency: 'USD',
            supplier: ['Saffron Table'],
            documentNumber: null,
            description: ['lunch', 'meal', 'biryani', 'restaurant', 'food'],
            lineAmounts: [18, 15.5, 13.5],
            charges: [8.46],
            discounts: [],
        },
    },
    {
        id: 'en-membership-no-currency',
        tags: ['en', 'receipt', 'missing_fields'],
        buyer: 'Tern & Finch Design LLC',
        text: `PAYMENT CONFIRMATION
Ref: 77-AC-2093
Received with thanks from Tern & Finch Design LLC
for: annual membership, Riverside Makers Guild
Amount: 150.00
Date received: 2026-08-30
`,
        expected: {
            date: '2026-08-30',
            total: 150,
            currency: null,
            supplier: ['Riverside Makers Guild'],
            documentNumber: ['77-AC-2093'],
            description: ['membership'],
            ...NO_ITEMS,
        },
    },
    {
        id: 'pt-nfe-distribuidora',
        tags: ['pt', 'invoice', 'number_format'],
        buyer: 'Padaria Pão Quente ME',
        text: `NOTA FISCAL ELETRÔNICA - NF-e
Nº 000.457.112   Série 001
DATA DE EMISSÃO: 08/09/2026

EMITENTE: Distribuidora Andorinha Ltda
CNPJ: 12.345.678/0001-90
DESTINATÁRIO: Padaria Pão Quente ME

PRODUTOS / SERVIÇOS
COD   DESCRIÇÃO                  QTD   V.UNIT     V.TOTAL
0012  Farinha de trigo 25kg       10    98,40      984,00
0031  Fermento biológico 500g     12    14,70      176,40
0045  Açúcar refinado 5kg          6    19,80      118,80

VALOR TOTAL DOS PRODUTOS                         1.279,20
VALOR DO FRETE                                       45,00
VALOR TOTAL DA NOTA                          R$  1.324,20
`,
        expected: {
            date: '2026-09-08',
            total: 1324.2,
            currency: 'BRL',
            supplier: ['Distribuidora Andorinha'],
            documentNumber: ['000.457.112', '457112'],
            description: ['farinha', 'fermento', 'acucar', 'insumos', 'ingredientes'],
            lineAmounts: [984, 176.4, 118.8],
            charges: [45],
            discounts: [],
        },
    },
    {
        id: 'pt-cupom-padaria',
        tags: ['pt', 'receipt', 'messy', 'number_format'],
        buyer: 'Padaria Pão Quente ME',
        text: `PADARIA E CONFEITARIA ESTRELA DO SUL
R. DAS FLORES 120 - CAMPINAS SP
CNPJ 98.765.432/0001-10
------------------------------------
CUPOM NAO FISCAL   No 004812
12/10/26 07:48
------------------------------------
ITEM DESCRICAO        QTD  VL ITEM
001 PAO FRANCES KG    0,750  11,25
002 LEITE INTEGRAL 1L   2     9,98
003 BOLO FUBA FATIA     1     7,50
------------------------------------
TOTAL R$                      28,73
DINHEIRO                      30,00
TROCO                          1,27
`,
        expected: {
            date: '2026-10-12',
            total: 28.73,
            currency: 'BRL',
            supplier: ['Estrela do Sul'],
            documentNumber: ['004812'],
            description: ['pao', 'padaria', 'leite', 'bolo', 'paes'],
            lineAmounts: [11.25, 9.98, 7.5],
            charges: [],
            discounts: [],
        },
    },
    {
        id: 'pt-fatura-telefone',
        tags: ['pt', 'email', 'invoice', 'distractor_dates'],
        buyer: 'Padaria Pão Quente ME',
        text: `Assunto: Sua fatura Telenova de setembro chegou

Olá, Marcos!

Sua fatura da Telenova Fibra já está disponível.

Fatura nº 2026091877
Emissão: 25/09/2026
Vencimento: 10/10/2026
Período de referência: 01/09/2026 a 30/09/2026

Plano Fibra 600 Mega ........ R$ 119,90
Telefone fixo ilimitado ...... R$ 29,90
Desconto fidelidade ......... -R$ 15,00

Valor total: R$ 134,80

Pague com Pix ou boleto até o vencimento.
`,
        expected: {
            date: '2026-09-25',
            total: 134.8,
            currency: 'BRL',
            supplier: ['Telenova'],
            documentNumber: ['2026091877'],
            description: ['internet', 'fibra', 'telefone', 'plano', 'telecom'],
            lineAmounts: [119.9, 29.9],
            charges: [],
            discounts: [15],
        },
    },
    {
        id: 'pt-recibo-aluguel',
        tags: ['pt', 'receipt', 'missing_fields'],
        buyer: 'Ana Beatriz Coelho',
        text: `RECIBO

Recebi de Ana Beatriz Coelho a importância de R$ 2.300,00
(dois mil e trezentos reais), referente ao aluguel do mês de
outubro de 2026 do imóvel situado à Rua Ipê Amarelo, 45, apto 32.

Para clareza, firmo o presente.

Belo Horizonte, 5 de outubro de 2026.

Ricardo Menezes Prado
CPF 123.456.789-00
`,
        expected: {
            date: '2026-10-05',
            total: 2300,
            currency: 'BRL',
            supplier: ['Ricardo Menezes Prado'],
            documentNumber: null,
            description: ['aluguel', 'rent'],
            ...NO_ITEMS,
        },
    },
    {
        id: 'pt-nota-servico-sem-data',
        tags: ['pt', 'invoice', 'missing_fields'],
        buyer: 'Condomínio Jardim das Acácias',
        text: `NOTA DE SERVIÇO 318
Prestador: Hidráulica Bom Fluxo - Serviços Residenciais
Cliente: Condomínio Jardim das Acácias

Serviço executado:
Troca de registro do barrilete e reparo de vazamento na
garagem (bloco B).

Mão de obra ............ R$ 480,00
Materiais .............. R$ 215,40
TOTAL .................. R$ 695,40

Assinatura do responsável: ____________
`,
        expected: {
            date: null,
            total: 695.4,
            currency: 'BRL',
            supplier: ['Bom Fluxo'],
            documentNumber: ['318'],
            description: ['vazamento', 'registro', 'hidraulic', 'reparo', 'encanamento'],
            lineAmounts: [480, 215.4],
            charges: [],
            discounts: [],
        },
    },
    {
        id: 'pt-email-corrida',
        tags: ['pt', 'email', 'receipt'],
        buyer: 'Padaria Pão Quente ME',
        text: `Recibo da sua viagem com a Rodax

domingo, 4 de outubro de 2026

Total  R$ 27,90

Tarifa da viagem      R$ 24,40
Taxa de reserva        R$ 2,00
Pedágio                R$ 1,50

Origem: Av. Paulista, 1578
Destino: Rua Augusta, 2690
Pago com Pix

Código da viagem: RDX-7Q4-K19
`,
        expected: {
            date: '2026-10-04',
            total: 27.9,
            currency: 'BRL',
            supplier: ['Rodax'],
            documentNumber: ['RDX-7Q4-K19'],
            description: ['viagem', 'corrida', 'transporte'],
            lineAmounts: [24.4, 2, 1.5],
            charges: [],
            discounts: [],
        },
    },
    {
        id: 'pt-mercado-sem-ano',
        tags: ['pt', 'receipt', 'yearless_date', 'number_format'],
        buyer: 'Padaria Pão Quente ME',
        text: `SUPERMERCADO BOA COMPRA
Loja 07 - Recife PE
Data: 15/10   Hora: 19:22   Caixa 3   Cupom 118204

ARROZ TIPO 1 5KG            27,90
FEIJAO CARIOCA 1KG           8,49
OLEO SOJA 900ML              7,99
CAFE TORRADO 500G           18,90
DETERGENTE 500ML x2          4,58
SUBTOTAL                    67,86
DESCONTO CLUBE              -3,50
TOTAL A PAGAR R$            64,36
CARTAO DEBITO               64,36
`,
        expected: {
            date: '2026-10-15',
            total: 64.36,
            currency: 'BRL',
            supplier: ['Boa Compra'],
            documentNumber: ['118204'],
            description: ['supermercado', 'mercado', 'compras', 'alimentos', 'arroz', 'mantimentos'],
            lineAmounts: [27.9, 8.49, 7.99, 18.9, 4.58],
            charges: [],
            discounts: [3.5],
        },
    },
    {
        id: 'pt-email-sem-valor',
        tags: ['pt', 'email', 'missing_fields'],
        buyer: 'Padaria Pão Quente ME',
        text: `Assunto: NF de outubro

Oi, Júlia,

Segue em anexo a nota fiscal referente à manutenção dos
computadores do escritório. Qualquer dúvida, é só chamar.

Abraço,
Felipe
TecnoReparo Informática
`,
        expected: {
            date: null,
            total: null,
            currency: null,
            supplier: ['TecnoReparo'],
            documentNumber: null,
            description: ['manutencao', 'computador'],
            ...NO_ITEMS,
        },
    },
    {
        id: 'img-en-grocery-receipt',
        tags: ['en', 'receipt', 'image'],
        buyer: 'Tern & Finch Design LLC',
        image: { file: 'en-grocery-receipt.png', format: 'png' },
        expected: {
            date: '2026-09-18',
            total: 18.97,
            currency: 'USD',
            supplier: ['Greenleaf Market'],
            documentNumber: ['GL-20931'],
            description: ['grocer', 'banana', 'yogurt', 'sourdough', 'spinach', 'food', 'market'],
            lineAmounts: [2.49, 6.99, 5.5, 3.99],
            charges: [],
            discounts: [],
        },
    },
    {
        id: 'img-pt-farmacia',
        tags: ['pt', 'receipt', 'image', 'number_format'],
        buyer: 'Padaria Pão Quente ME',
        image: { file: 'pt-farmacia.jpg', format: 'jpeg' },
        expected: {
            date: '2026-10-03',
            total: 74.2,
            currency: 'BRL',
            supplier: ['Boa Saude'],
            documentNumber: ['552871'],
            description: ['farmacia', 'dipirona', 'protetor', 'escova', 'medicamento', 'higiene'],
            lineAmounts: [6.9, 54.9, 12.4],
            charges: [],
            discounts: [],
        },
    },
    {
        id: 'img-en-invoice-no-date',
        tags: ['en', 'invoice', 'image', 'missing_fields'],
        buyer: 'Tern & Finch Design LLC',
        image: { file: 'en-invoice-no-date.png', format: 'png' },
        expected: {
            date: null,
            total: 460,
            currency: 'USD',
            supplier: ['Northfield Sign'],
            documentNumber: ['NSC-1554'],
            description: ['lettering', 'vinyl', 'sign', 'installation'],
            lineAmounts: [320, 140],
            charges: [],
            discounts: [],
        },
    },
    {
        id: 'img-pt-servico-eletrica',
        tags: ['pt', 'invoice', 'image'],
        buyer: 'Padaria Pão Quente ME',
        image: { file: 'pt-servico-eletrica.png', format: 'png' },
        expected: {
            date: '2026-09-21',
            total: 385,
            currency: 'BRL',
            supplier: ['Luz Forte'],
            documentNumber: ['2077'],
            description: ['tomada', 'disjuntor', 'eletric', 'instalacao'],
            lineAmounts: [320, 95],
            charges: [],
            discounts: [30],
        },
    },
];
