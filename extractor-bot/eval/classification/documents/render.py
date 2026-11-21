"""Renders the synthetic documents of the file classification trial.

Run from this directory with Pillow and the DejaVu fonts installed:

    python3 render.py

Every business, person, account and number is invented. Labels are in ../cases.ts.
Rendering is deterministic: running it again leaves every file unchanged.
"""

import io
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONTS = {
    'R': '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    'B': '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    'M': '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
    'MB': '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',
}
PDF_FONTS = {'R': 'Helvetica', 'B': 'Helvetica-Bold', 'M': 'Courier', 'MB': 'Courier-Bold'}
LETTER = (612, 792)
A4 = (595, 842)


def font(kind, size):
    return ImageFont.truetype(FONTS[kind], size)


# ---------------------------------------------------------------------------------------------
# Paged documents, written as PDFs with a text layer or rendered as scans


class Doc:
    """Lines laid out top to bottom on pages, in points from the top-left corner."""

    def __init__(self, size=LETTER, margin=48):
        self.size = size
        self.margin = margin
        self.pages = [[]]
        self.y = margin

    def new_page(self):
        self.pages.append([])
        self.y = self.margin

    def text(self, text, size=10, kind='R', x=None, right=None):
        lead = size * 1.4
        if self.y + lead > self.size[1] - self.margin - 14:
            self.new_page()
        self.y += lead
        self.pages[-1].append(('t', x if x is not None else self.margin, self.y, size, kind, text))
        if right is not None:
            self.pages[-1].append(('t', self.size[0] / 2 + 40, self.y, size, kind, right))

    def shaded(self, text, size=9, kind='MB'):
        lead = size * 1.4
        if self.y + lead + 4 > self.size[1] - self.margin - 14:
            self.new_page()
        width = self.size[0] - 2 * self.margin
        self.pages[-1].append(('r', self.margin - 4, self.y + 2, width + 8, lead + 2, 0.88))
        self.y += 2
        self.text(text, size, kind)

    def space(self, points=8):
        self.y += points

    def rule(self):
        self.y += 6
        self.pages[-1].append(('l', self.margin, self.y, self.size[0] - self.margin, self.y))
        self.y += 4

    def footer(self, make):
        count = len(self.pages)
        for number, ops in enumerate(self.pages, 1):
            ops.append(('t', self.margin, self.size[1] - self.margin + 10, 8, 'R', make(number, count)))


def pdf_text(text):
    data = text.encode('cp1252')
    return data.replace(b'\\', b'\\\\').replace(b'(', b'\\(').replace(b')', b'\\)')


def save_pdf(path, size, pages):
    """Writes a PDF from pages of (content stream, font resources, JPEG images) with no dates or IDs."""
    width, height = size
    objects = []

    def add(data):
        objects.append(data)
        return len(objects)

    catalog = add(None)
    parent = add(None)
    fonts = {
        kind: add(f'<< /Type /Font /Subtype /Type1 /BaseFont /{name} /Encoding /WinAnsiEncoding >>'.encode())
        for kind, name in PDF_FONTS.items()
    }
    kids = []
    for stream, use_fonts, jpegs in pages:
        resources = ''
        if use_fonts:
            resources += '/Font << ' + ' '.join(f'/F{kind} {number} 0 R' for kind, number in fonts.items()) + ' >> '
        if jpegs:
            names = []
            for index, (jpeg, pixels) in enumerate(jpegs):
                image = add(
                    f'<< /Type /XObject /Subtype /Image /Width {pixels[0]} /Height {pixels[1]} /ColorSpace /DeviceGray '
                    f'/BitsPerComponent 8 /Filter /DCTDecode /Length {len(jpeg)} >>\nstream\n'.encode() + jpeg + b'\nendstream'
                )
                names.append(f'/Im{index} {image} 0 R')
            resources += '/XObject << ' + ' '.join(names) + ' >>'
        content = add(b'<< /Length %d >>\nstream\n' % len(stream) + bytes(stream) + b'endstream')
        kids.append(add(
            f'<< /Type /Page /Parent {parent} 0 R /MediaBox [0 0 {width} {height}] '
            f'/Resources << {resources} >> /Contents {content} 0 R >>'.encode()
        ))
    objects[catalog - 1] = f'<< /Type /Catalog /Pages {parent} 0 R >>'.encode()
    objects[parent - 1] = f'<< /Type /Pages /Kids [{" ".join(f"{kid} 0 R" for kid in kids)}] /Count {len(kids)} >>'.encode()

    out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offsets = []
    for number, data in enumerate(objects, 1):
        offsets.append(len(out))
        out += f'{number} 0 obj\n'.encode() + data + b'\nendobj\n'
    xref = len(out)
    out += f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode()
    for offset in offsets:
        out += f'{offset:010d} 00000 n \n'.encode()
    out += f'trailer\n<< /Size {len(objects) + 1} /Root {catalog} 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    with open(path, 'wb') as file:
        file.write(out)


def write_pdf(doc, path):
    """A PDF with a text layer, as accounting and banking systems export them."""
    height = doc.size[1]
    pages = []
    for ops in doc.pages:
        stream = bytearray()
        for op in ops:
            if op[0] == 't':
                _, x, y, size, kind, text = op
                stream += f'BT /F{kind} {size} Tf {x:.1f} {height - y:.1f} Td ('.encode() + pdf_text(text) + b') Tj ET\n'
            elif op[0] == 'l':
                _, x1, y1, x2, y2 = op
                stream += f'0.6 w {x1:.1f} {height - y1:.1f} m {x2:.1f} {height - y2:.1f} l S\n'.encode()
            elif op[0] == 'r':
                _, x, y, w, h, gray = op
                stream += f'{gray} g {x:.1f} {height - y - h:.1f} {w:.1f} {h:.1f} re f 0 g\n'.encode()
        pages.append((stream, True, []))
    save_pdf(path, doc.size, pages)


def scan_pages(doc, seed, angle, dpi=150):
    """Grayscale page images of a document, slightly rotated, noisy and soft, as a scanner makes them."""
    scale = dpi / 72
    rng = random.Random(seed)
    images = []
    for ops in doc.pages:
        size = (round(doc.size[0] * scale), round(doc.size[1] * scale))
        image = Image.new('L', size, 255)
        draw = ImageDraw.Draw(image)
        for op in ops:
            if op[0] == 'r':
                _, x, y, w, h, gray = op
                draw.rectangle([x * scale, y * scale, (x + w) * scale, (y + h) * scale], fill=round(255 * gray))
        for op in ops:
            if op[0] == 't':
                _, x, y, text_size, kind, text = op
                draw.text((x * scale, y * scale), text, font=font(kind, round(text_size * scale)), fill=30, anchor='ls')
            elif op[0] == 'l':
                _, x1, y1, x2, y2 = op
                draw.line([x1 * scale, y1 * scale, x2 * scale, y2 * scale], fill=70, width=2)
        image = image.rotate(angle, resample=Image.BICUBIC, fillcolor=255)
        noise = Image.frombytes('L', size, rng.randbytes(size[0] * size[1]))
        image = Image.blend(image, noise, 0.07).filter(ImageFilter.GaussianBlur(0.7))
        images.append(image)
        angle = -angle * 0.6
    return images


def write_scan(doc, path, seed, angle=0.5):
    """An image-only PDF, one JPEG per page, as a scanner makes it: no text layer."""
    pages = []
    for image in scan_pages(doc, seed, angle):
        buffer = io.BytesIO()
        image.save(buffer, 'JPEG', quality=70)
        stream = f'q {doc.size[0]} 0 0 {doc.size[1]} 0 0 cm /Im0 Do Q\n'.encode()
        pages.append((stream, False, [(buffer.getvalue(), image.size)]))
    save_pdf(path, doc.size, pages)


# ---------------------------------------------------------------------------------------------
# Money and dates

def usd(amount):
    sign = '-' if amount < 0 else ''
    return f'{sign}{abs(amount):,.2f}'


def brl(amount):
    sign = '-' if amount < 0 else ''
    text = f'{abs(amount):,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
    return f'{sign}{text}'


EN_DEBITS = [
    'POS PURCHASE GREENLEAF MARKET AUSTIN TX', 'ACH DEBIT CITYPOWER UTILITIES', 'DEBIT CARD BLUE MESA CAFE',
    'ATM WITHDRAWAL 5TH AND MAIN', 'ACH DEBIT NORTHWIND INSURANCE', 'RECURRING STREAMFLIX.COM',
    'ZELLE TO R OKAFOR', 'DEBIT CARD FUELWAY 221', 'ONLINE TRANSFER TO SAV 7713', 'DEBIT CARD PINECONE HARDWARE',
    'ACH DEBIT LONESTAR MORTGAGE', 'DEBIT CARD ORBIT ELECTRONICS', 'CHECK 1042', 'DEBIT CARD TACO RIO',
]
EN_CREDITS = ['PAYROLL DEPOSIT ACME TOOLING INC', 'MOBILE DEPOSIT', 'ZELLE FROM J PATEL', 'REFUND ORBIT ELECTRONICS']
PT_DEBITS = [
    'PIX ENVIADO MARIA SOUZA', 'COMPRA CARTAO DEB PADARIA BOM PAO', 'PAGTO BOLETO ENERGISUL', 'TARIFA PACOTE SERVICOS',
    'SAQUE 24H', 'DEB AUTOMATICO VIVAZ TELECOM', 'COMPRA CARTAO DEB POSTO ARAUCARIA', 'PIX ENVIADO ALUGUEL IMOVEIS SUL',
    'COMPRA CARTAO DEB FARMACIA VIDA', 'PAGTO BOLETO CONDOMINIO JARDINS',
]
PT_CREDITS = ['PIX RECEBIDO JOAO LIMA', 'TED RECEBIDA CLIENTE ALFA LTDA', 'PAGTO SALARIO', 'RENDIMENTO POUPANCA']


def statement_rows(rng, count, debits, credits, month, start_day=1, end_day=30):
    """Dated rows with signed amounts, in date order."""
    days = sorted(rng.randint(start_day, end_day) for _ in range(count))
    rows = []
    for day in days:
        if rng.random() < 0.18:
            rows.append((day, rng.choice(credits), round(rng.uniform(150, 3200), 2)))
        else:
            rows.append((day, rng.choice(debits), -round(rng.uniform(4, 420), 2)))
    return rows


# ---------------------------------------------------------------------------------------------
# Statements


def en_bank_statement(seed, rows, bank='Harbor Federal Bank', title='Everyday Checking', few=None,
                      address='PO Box 4410, Austin TX 78701  |  harborfederal.example'):
    rng = random.Random(seed)
    doc = Doc()
    doc.text(bank.upper(), 16, 'B')
    doc.text(address, 8)
    doc.space(10)
    doc.text(f'{title} Statement', 13, 'B', right='Account number: ****4471')
    doc.text('Statement period: September 1, 2026 - September 30, 2026', 9, right='Customer: Riverbend Design LLC')
    doc.rule()
    entries = few if few is not None else statement_rows(rng, rows, EN_DEBITS, EN_CREDITS, 9)
    opening = 5230.18
    deposits = sum(amount for _, _, amount in entries if amount > 0)
    withdrawals = -sum(amount for _, _, amount in entries if amount < 0)
    doc.text('Account summary', 11, 'B')
    doc.text(f'{"Beginning balance on 09/01":<34}{usd(opening):>14}', 9, 'M')
    doc.text(f'{"Deposits and other credits":<34}{usd(deposits):>14}', 9, 'M')
    doc.text(f'{"Withdrawals and other debits":<34}{usd(-withdrawals):>14}', 9, 'M')
    doc.text(f'{"Ending balance on 09/30":<34}{usd(opening + deposits - withdrawals):>14}', 9, 'MB')
    doc.space(10)
    doc.text('Transaction history', 11, 'B')
    doc.shaded(f'{"Date":<7}{"Description":<42}{"Amount":>12}{"Balance":>13}', 8)
    balance = opening
    for day, description, amount in entries:
        balance += amount
        doc.text(f'{f"09/{day:02d}":<7}{description:<42}{usd(amount):>12}{usd(balance):>13}', 8, 'M')
    doc.space(6)
    doc.text(f'Ending balance {usd(balance)}', 9, 'B')
    doc.footer(lambda n, c: f'{bank}  -  Member FDIC  -  Page {n} of {c}')
    return doc


def en_card_statement():
    rng = random.Random(4)
    doc = Doc()
    doc.text('MERIDIAN REWARDS VISA', 16, 'B')
    doc.text('Meridian Card Services  |  PO Box 9020, Wilmington DE 19899', 8)
    doc.space(8)
    doc.text('Cardmember: Dana Whitfield', 9, right='Account ending in 3307')
    doc.text('Statement closing date: 10/05/2026', 9, right='Payment due date: 11/01/2026')
    doc.rule()
    entries = []
    days = sorted(rng.randint(6, 35) for _ in range(24))
    merchants = ['AMAZON MKTP US', 'SHELL OIL 5741', 'WHOLE HARVEST FOODS', 'DELTA AIR 0062', 'UBER TRIP', 'SPOTIFY',
                 'HOME DEPOT 6512', 'STARBUCKS 2201', 'TARGET 0934', 'CVS PHARMACY', 'NETFLIX.COM', 'CHEWY.COM']
    for day in days:
        month, date = (9, day) if day <= 30 else (10, day - 30)
        entries.append((f'{month:02d}/{date:02d}', rng.choice(merchants), round(rng.uniform(6, 380), 2)))
    previous = 1184.55
    purchases = sum(amount for _, _, amount in entries)
    new_balance = previous - 1184.55 + purchases
    doc.text('Account summary', 11, 'B', right='Payment information')
    doc.text(f'{"Previous balance":<24}{usd(previous):>12}', 9, 'M', right=f'New balance: ${usd(new_balance)}')
    doc.text(f'{"Payments":<24}{usd(-1184.55):>12}', 9, 'M', right='Minimum payment due: $35.00')
    doc.text(f'{"Purchases":<24}{usd(purchases):>12}', 9, 'M', right='Payment due date: 11/01/2026')
    doc.text(f'{"Interest charged":<24}{usd(0):>12}', 9, 'M')
    doc.text(f'{"New balance":<24}{usd(new_balance):>12}', 9, 'MB')
    doc.space(10)
    doc.text('Transactions', 11, 'B')
    doc.shaded(f'{"Trans date":<12}{"Description":<44}{"Amount":>12}', 8)
    doc.text(f'{"09/12":<12}{"PAYMENT THANK YOU":<44}{usd(-1184.55):>12}', 8, 'M')
    for date, merchant, amount in entries:
        doc.text(f'{date:<12}{merchant:<44}{usd(amount):>12}', 8, 'M')
    doc.space(6)
    doc.text(f'Total purchases for this period ${usd(purchases)}', 9, 'B')
    doc.footer(lambda n, c: f'Meridian Card Services  -  Page {n} of {c}')
    return doc


def pt_extrato(seed, rows):
    rng = random.Random(seed)
    doc = Doc(A4)
    doc.text('BANCO IPÊ S.A.', 16, 'B')
    doc.text('Extrato de conta corrente', 12, 'B', right='Agência 0412  Conta 88213-5')
    doc.text('Cliente: Padaria Pão Quente ME', 9, right='Período: 01/10/2026 a 31/10/2026')
    doc.rule()
    entries = statement_rows(rng, rows, PT_DEBITS, PT_CREDITS, 10, 1, 31)
    saldo = 3120.40
    doc.shaded(f'{"Data":<7}{"Lançamento":<40}{"Valor (R$)":>13}{"Saldo (R$)":>14}', 8)
    doc.text(f'{"01/10":<7}{"SALDO ANTERIOR":<40}{"":>13}{brl(saldo):>14}', 8, 'M')
    for day, description, amount in entries:
        saldo += amount
        doc.text(f'{f"{day:02d}/10":<7}{description:<40}{brl(amount):>13}{brl(saldo):>14}', 8, 'M')
    doc.text(f'{"31/10":<7}{"SALDO FINAL":<40}{"":>13}{brl(saldo):>14}', 8, 'MB')
    doc.space(8)
    doc.text('Ouvidoria Banco Ipê 0800 000 0000. Extrato emitido em 01/11/2026.', 7)
    doc.footer(lambda n, c: f'Banco Ipê S.A.  -  Página {n} de {c}')
    return doc


def pt_fatura_cartao():
    rng = random.Random(6)
    doc = Doc(A4)
    doc.text('IPÊ MASTERCARD GOLD', 16, 'B')
    doc.text('Fatura do cartão de crédito', 12, 'B', right='Cartão final 9902')
    doc.text('Titular: Carla Menezes', 9, right='Fechamento: 03/10/2026')
    doc.rule()
    lancamentos = []
    lojas = ['SUPERMERCADO BOA COMPRA', 'POSTO ARAUCARIA', 'MAGAZINE CENTRAL', 'IFOOD *RESTAURANTE', 'UBER *TRIP',
             'NETFLIX.COM', 'FARMACIA VIDA', 'LIVRARIA CULTURA SUL', 'CINEMARK', 'AMAZON BR']
    for day in sorted(rng.randint(4, 30) for _ in range(20)):
        loja = rng.choice(lojas)
        if rng.random() < 0.2:
            loja = f'{loja} PARC {rng.randint(2, 5)}/6'
        lancamentos.append((f'{day:02d}/09', loja, round(rng.uniform(12, 640), 2)))
    total = sum(valor for _, _, valor in lancamentos)
    doc.text(f'Total desta fatura: R$ {brl(total)}', 12, 'B', right='Vencimento: 15/10/2026')
    doc.text(f'Pagamento mínimo: R$ {brl(total * 0.15)}', 9, right='Limite disponível: R$ 7.410,00')
    doc.space(10)
    doc.text('Lançamentos', 11, 'B')
    doc.shaded(f'{"Data":<8}{"Descrição":<46}{"Valor (R$)":>14}', 8)
    doc.text(f'{"10/09":<8}{"PAGAMENTO EFETUADO":<46}{brl(-2210.37):>14}', 8, 'M')
    for data, loja, valor in lancamentos:
        doc.text(f'{data:<8}{loja:<46}{brl(valor):>14}', 8, 'M')
    doc.space(6)
    doc.text(f'Total dos lançamentos atuais R$ {brl(total)}', 9, 'B')
    doc.footer(lambda n, c: f'Banco Ipê S.A.  -  Página {n} de {c}')
    return doc


def en_quiet_statement():
    few = [(28, 'INTEREST PAYMENT', 0.42), (30, 'MONTHLY MAINTENANCE FEE', -5.00)]
    return en_bank_statement(11, 0, title='Business Savings', few=few)


def en_payment_platform_activity():
    rng = random.Random(12)
    doc = Doc()
    doc.text('Paystream', 18, 'B')
    doc.text('Activity report  -  Riverbend Design LLC  -  merchant ID PS-2209-114', 9)
    doc.text('Period: October 1, 2026 to October 31, 2026  -  Currency: USD', 9)
    doc.rule()
    doc.shaded(f'{"Date":<7}{"Type":<15}{"Details":<28}{"Gross":>10}{"Fee":>8}{"Net":>10}', 8)
    clients = ['Lumen Studio', 'Okafor Bakery', 'Patel & Co', 'Northwind Supply', 'Cedar Dental', 'Blue Mesa Cafe']
    for day in sorted(rng.randint(1, 31) for _ in range(26)):
        if rng.random() < 0.2:
            amount = -round(rng.uniform(800, 2500), 2)
            doc.text(f'{f"10/{day:02d}":<7}{"Payout":<15}{"To bank ****4471":<28}{usd(amount):>10}{"0.00":>8}{usd(amount):>10}', 8, 'M')
        else:
            gross = round(rng.uniform(40, 900), 2)
            fee = round(gross * 0.029 + 0.3, 2)
            doc.text(f'{f"10/{day:02d}":<7}{"Payment":<15}{rng.choice(clients):<28}{usd(gross):>10}{usd(-fee):>8}{usd(gross - fee):>10}', 8, 'M')
    doc.footer(lambda n, c: f'Paystream Inc.  -  Page {n} of {c}')
    return doc


# ---------------------------------------------------------------------------------------------
# Single-transaction documents


def en_invoice():
    doc = Doc()
    doc.text('Lumen Studio', 18, 'B', right='INVOICE')
    doc.text('88 Alder Street, Portland OR 97205', 9, right='Invoice no. LS-2026-118')
    doc.text('billing@lumenstudio.example', 9, right='Date: October 14, 2026')
    doc.space(10)
    doc.text('Bill to: Riverbend Design LLC, 12 Mill Road, Austin TX', 9)
    doc.rule()
    doc.shaded(f'{"Description":<44}{"Qty":>5}{"Rate":>10}{"Amount":>12}', 9)
    for name, qty, rate in [('Brand photography, half day', 1, 950.0), ('Photo retouching', 24, 18.0), ('Usage license, 1 year', 1, 400.0)]:
        doc.text(f'{name:<44}{qty:>5}{usd(rate):>10}{usd(qty * rate):>12}', 9, 'M')
    doc.rule()
    doc.text(f'{"Subtotal":<59}{usd(1782):>12}', 9, 'M')
    doc.text(f'{"Total due (USD)":<59}{usd(1782):>12}', 9, 'MB')
    doc.space(10)
    doc.text('Payment due within 30 days. Thank you for your business.', 9)
    return doc


def en_timesheet_invoice():
    rng = random.Random(21)
    doc = Doc()
    doc.text('OKAFOR CONSULTING', 16, 'B', right='INVOICE #OC-0931')
    doc.text('Ruth Okafor, 410 Elm Ave, Dallas TX', 9, right='Issued: 10/03/2026   Due: 11/02/2026')
    doc.text('Client: Riverbend Design LLC', 9, right='Services for September 2026')
    doc.rule()
    doc.shaded(f'{"Date":<7}{"Work performed":<44}{"Hours":>6}{"Rate":>8}{"Amount":>10}', 8)
    tasks = ['Requirements workshop', 'Data model review', 'API integration', 'Bug triage and fixes', 'Status meeting',
             'Deployment support', 'Report development', 'Code review', 'Documentation', 'User acceptance testing']
    total = 0.0
    for day in sorted(rng.randint(1, 30) for _ in range(32)):
        hours = rng.choice([0.5, 1, 1.5, 2, 3, 4, 6])
        total += hours * 120
        doc.text(f'{f"09/{day:02d}":<7}{rng.choice(tasks):<44}{hours:>6}{"120.00":>8}{usd(hours * 120):>10}', 8, 'M')
    doc.rule()
    doc.text(f'{"Total amount due":<65}{usd(total):>10}', 9, 'MB')
    doc.text('Please pay by ACH to account ****8810. Thank you!', 9)
    return doc


def en_two_page_invoice():
    rng = random.Random(22)
    doc = Doc()
    doc.text('NORTHWIND SUPPLY CO.', 16, 'B', right='INVOICE')
    doc.text('2200 Harbor Blvd, Long Beach CA 90813', 9, right='Invoice number: NW-448210')
    doc.text('Sold to: Pinecone Hardware, Boise ID', 9, right='Invoice date: 10/20/2026')
    doc.text('PO number: PH-7781', 9, right='Terms: Net 30')
    doc.rule()
    doc.shaded(f'{"SKU":<10}{"Item":<36}{"Qty":>5}{"Unit":>9}{"Ext. price":>12}', 8)
    items = ['Wood screws #8 x 1-1/4 (100)', 'Hinge, steel 3.5in', 'Paint roller 9in', 'Drywall anchors (50)',
             'PVC elbow 1/2in', 'Extension cord 25ft', 'Work gloves L', 'Masking tape 2in', 'Utility knife',
             'Cabinet pull, brushed', 'Wood glue 16oz', 'Sandpaper 120 grit (25)', 'LED bulb A19 4-pack']
    subtotal = 0.0
    for _ in range(58):
        qty = rng.randint(1, 48)
        unit = round(rng.uniform(1.2, 38), 2)
        subtotal += qty * unit
        doc.text(f'{f"NW-{rng.randint(10000, 99999)}":<10}{rng.choice(items):<36}{qty:>5}{usd(unit):>9}{usd(qty * unit):>12}', 8, 'M')
    tax = round(subtotal * 0.06, 2)
    doc.rule()
    doc.text(f'{"Subtotal":<60}{usd(subtotal):>12}', 9, 'M')
    doc.text(f'{"Sales tax 6%":<60}{usd(tax):>12}', 9, 'M')
    doc.text(f'{"Invoice total":<60}{usd(subtotal + tax):>12}', 9, 'MB')
    doc.footer(lambda n, c: f'Northwind Supply Co.  -  Invoice NW-448210  -  Page {n} of {c}')
    return doc


def pt_nota_fiscal():
    doc = Doc(A4)
    doc.text('DANFE - Documento Auxiliar da Nota Fiscal Eletrônica', 11, 'B')
    doc.text('DISTRIBUIDORA GRÃOS DO SUL LTDA  -  CNPJ 12.345.678/0001-90', 9, 'B')
    doc.text('Rua das Indústrias, 900 - Chapecó SC', 8, right='NF-e nº 000.041.227  Série 1')
    doc.text('Destinatário: Padaria Pão Quente ME  -  CNPJ 98.765.432/0001-10', 8, right='Emissão: 08/10/2026')
    doc.text('Chave de acesso: 4226 1012 3456 7800 0190 5500 1000 0412 2710 0041 2273', 8)
    doc.rule()
    doc.shaded(f'{"Cód.":<7}{"Descrição do produto":<34}{"Qtd":>6}{"Un":>4}{"V. unit":>10}{"V. total":>11}', 8)
    itens = [('1001', 'FARINHA DE TRIGO TIPO 1 25KG', 12, 'SC', 98.5), ('1002', 'AÇÚCAR REFINADO 5KG', 20, 'PC', 21.9),
             ('1003', 'FERMENTO BIOLÓGICO 500G', 15, 'PC', 14.2), ('1004', 'MARGARINA 15KG', 4, 'BD', 189.0),
             ('1005', 'SAL REFINADO 1KG', 30, 'PC', 2.8), ('1006', 'OVOS BRANCOS CX 30DZ', 2, 'CX', 265.0),
             ('1007', 'LEITE INTEGRAL 1L', 48, 'UN', 4.9), ('1008', 'CHOCOLATE EM PÓ 1KG', 6, 'PC', 32.5)]
    total = 0.0
    for code, name, qty, unit, price in itens:
        total += qty * price
        doc.text(f'{code:<7}{name:<34}{qty:>6}{unit:>4}{brl(price):>10}{brl(qty * price):>11}', 8, 'M')
    doc.rule()
    doc.text(f'{"VALOR TOTAL DOS PRODUTOS":<50}{brl(total):>22}', 9, 'M')
    doc.text(f'{"VALOR TOTAL DA NOTA":<50}{brl(total):>22}', 9, 'MB')
    doc.text('Dados adicionais: pagamento em boleto, vencimento 07/11/2026.', 8)
    return doc


def pt_fatura_telefonia():
    rng = random.Random(24)
    doc = Doc(A4)
    doc.text('VIVAZ TELECOM', 16, 'B', right='Fatura nº 2026100458812')
    doc.text('Cliente: Padaria Pão Quente ME', 9, right='Emissão: 05/10/2026')
    doc.text('Plano Empresa Conecta 50GB', 9, right='Vencimento: 20/10/2026')
    doc.rule()
    doc.text('Resumo da fatura', 11, 'B')
    doc.text(f'{"Mensalidade do plano":<44}{brl(149.9):>12}', 9, 'M')
    doc.text(f'{"Ligações fora do plano":<44}{brl(38.62):>12}', 9, 'M')
    doc.text(f'{"Serviços adicionais":<44}{brl(9.99):>12}', 9, 'M')
    doc.text(f'{"Total a pagar":<44}{brl(198.51):>12}', 10, 'MB')
    doc.text('Código de barras: 84650000001 98510123004 58812202610 20000000001', 8)
    doc.space(10)
    doc.text('Detalhamento de ligações', 11, 'B')
    doc.shaded(f'{"Data":<7}{"Hora":<7}{"Número chamado":<18}{"Tipo":<16}{"Duração":>9}{"Valor":>9}', 8)
    for day in sorted(rng.randint(1, 30) for _ in range(46)):
        kind = rng.choice(['Local fixo', 'Local móvel', 'DDD móvel', 'DDD fixo'])
        minutes = rng.randint(1, 22)
        doc.text(f'{f"{day:02d}/09":<7}{f"{rng.randint(8, 19):02d}:{rng.randint(0, 59):02d}":<7}'
                 f'{f"(49) 9{rng.randint(1000, 9999)}-{rng.randint(1000, 9999)}":<18}{kind:<16}'
                 f'{f"{minutes}min":>9}{brl(minutes * 0.12):>9}', 8, 'M')
    doc.footer(lambda n, c: f'Vivaz Telecom S.A.  -  Página {n} de {c}')
    return doc


def en_utility_bill():
    doc = Doc()
    doc.text('CITYPOWER UTILITIES', 16, 'B', right='Account 5520-1187-04')
    doc.text('Service address: 12 Mill Road, Austin TX', 9, right='Bill date: 10/06/2026')
    doc.text('Customer: Riverbend Design LLC', 9, right='Due date: 10/27/2026')
    doc.rule()
    doc.text('Account summary', 11, 'B')
    doc.text(f'{"Previous balance":<40}{usd(212.84):>12}', 9, 'M')
    doc.text(f'{"Payment received 09/14 - thank you":<40}{usd(-212.84):>12}', 9, 'M')
    doc.text(f'{"Balance forward":<40}{usd(0):>12}', 9, 'M')
    doc.text(f'{"New charges":<40}{usd(236.10):>12}', 9, 'M')
    doc.text(f'{"Total amount due":<40}{usd(236.10):>12}', 10, 'MB')
    doc.space(10)
    doc.text('New charges detail', 11, 'B')
    doc.shaded(f'{"Item":<40}{"Usage":>10}{"Amount":>12}', 8)
    for item, usage, amount in [('Electric delivery', '1,420 kWh', 71.0), ('Electric supply', '1,420 kWh', 134.9),
                                ('Customer charge', '', 12.5), ('Fuel adjustment', '', 9.1), ('Sales tax', '', 8.6)]:
        doc.text(f'{item:<40}{usage:>10}{usd(amount):>12}', 8, 'M')
    doc.space(10)
    doc.text('Usage history (kWh): Oct 1,420  Sep 1,610  Aug 1,880  Jul 1,790  Jun 1,350', 8)
    return doc


def en_hotel_folio():
    doc = Doc()
    doc.text('THE ALDER HOTEL', 16, 'B', right='Folio 77120')
    doc.text('500 Congress Ave, Austin TX', 9, right='Room 614')
    doc.text('Guest: Dana Whitfield', 9, right='Arrival 10/11/2026  Departure 10/16/2026')
    doc.rule()
    doc.shaded(f'{"Date":<8}{"Description":<40}{"Charges":>12}{"Credits":>12}', 8)
    for day in range(11, 16):
        doc.text(f'{f"10/{day}":<8}{"Room charge - King deluxe":<40}{usd(219):>12}{"":>12}', 8, 'M')
        doc.text(f'{f"10/{day}":<8}{"Occupancy tax":<40}{usd(37.23):>12}{"":>12}', 8, 'M')
    doc.text(f'{"10/13":<8}{"Restaurant - The Alder Grill":<40}{usd(64.5):>12}{"":>12}', 8, 'M')
    doc.text(f'{"10/16":<8}{"Visa ****3307 payment":<40}{"":>12}{usd(1345.65):>12}', 8, 'M')
    doc.rule()
    doc.text(f'{"Total charges":<48}{usd(1345.65):>12}', 9, 'M')
    doc.text(f'{"Balance due":<48}{usd(0):>12}', 9, 'MB')
    return doc


def en_invoice_short():
    doc = Doc()
    doc.text('CEDAR SIGN WORKS', 16, 'B', right='INVOICE 2291')
    doc.text('19 Ranch Road, Round Rock TX', 9, right='Date: 09/29/2026')
    doc.text('Customer: Riverbend Design LLC', 9)
    doc.rule()
    doc.shaded(f'{"Item":<40}{"Qty":>5}{"Price":>11}{"Total":>12}', 9)
    rows = [('Aluminum sign 24x36, printed', 2, 145.0), ('Mounting hardware kit', 2, 18.0), ('Installation', 1, 120.0),
            ('Design proof revisions', 3, 25.0), ('Vinyl window lettering', 4, 32.0), ('A-frame sidewalk sign', 1, 89.0),
            ('Delivery', 1, 35.0), ('Laminate coating', 2, 22.0), ('Rush fee', 1, 50.0), ('Disposal of old signs', 1, 40.0),
            ('Weatherproof sealing', 2, 15.0), ('Site survey', 1, 60.0)]
    total = 0.0
    for name, qty, price in rows:
        total += qty * price
        doc.text(f'{name:<40}{qty:>5}{usd(price):>11}{usd(qty * price):>12}', 9, 'M')
    doc.rule()
    doc.text(f'{"TOTAL DUE":<56}{usd(total):>12}', 10, 'MB')
    return doc


def en_receipt_doc():
    doc = Doc((260, 520), margin=18)
    doc.text('BLUE MESA CAFE', 13, 'B')
    doc.text('2101 S Lamar Blvd, Austin TX', 7)
    doc.text('Order 4418   10/09/2026 12:41', 7, 'M')
    doc.rule()
    for name, price in [('Breakfast burrito', 9.5), ('Huevos rancheros', 12.0), ('Cold brew L', 4.75), ('Orange juice', 3.5), ('Side bacon', 3.25)]:
        doc.text(f'{name:<20}{usd(price):>9}', 8, 'M')
    doc.rule()
    doc.text(f'{"Subtotal":<20}{usd(33.0):>9}', 8, 'M')
    doc.text(f'{"Tax":<20}{usd(2.72):>9}', 8, 'M')
    doc.text(f'{"Tip":<20}{usd(6.0):>9}', 8, 'M')
    doc.text(f'{"TOTAL":<20}{usd(41.72):>9}', 9, 'MB')
    doc.text('VISA ****3307  APPROVED', 7, 'M')
    doc.text('Thank you!', 8)
    return doc


def en_transfer_confirmation():
    doc = Doc()
    doc.text('HARBOR FEDERAL BANK', 16, 'B')
    doc.text('Outgoing wire transfer confirmation', 12, 'B')
    doc.rule()
    for label, value in [('Confirmation number', 'WT-26101588402'), ('Date sent', 'October 15, 2026'),
                         ('From account', 'Everyday Checking ****4471'), ('Beneficiary', 'Northwind Supply Co.'),
                         ('Beneficiary bank', 'Pacific Coast Bank, routing 122000661'), ('Beneficiary account', '****2290'),
                         ('Amount', 'USD 4,812.40'), ('Wire fee', 'USD 25.00'), ('Total debited', 'USD 4,837.40'),
                         ('Reference', 'Invoice NW-448210')]:
        doc.text(f'{label + ":":<24}{value}', 10, 'M')
    doc.space(10)
    doc.text('Keep this confirmation for your records. Questions: 1-800-555-0144.', 9)
    return doc


def en_quote():
    doc = Doc()
    doc.text('PATEL & CO RENOVATIONS', 16, 'B', right='ESTIMATE E-552')
    doc.text('31 Lake Shore Dr, Austin TX', 9, right='Valid until 11/30/2026')
    doc.text('Prepared for: Riverbend Design LLC', 9, right='Date: 10/22/2026')
    doc.rule()
    doc.shaded(f'{"Scope":<48}{"Estimate":>14}', 9)
    for name, amount in [('Demolition of existing partition', 1800), ('New drywall partition with door', 4250),
                         ('Electrical: 6 outlets, 4 fixtures', 2900), ('Paint, two coats, 900 sq ft', 2100),
                         ('Flooring, LVP 600 sq ft', 4800), ('Permits and cleanup', 750)]:
        doc.text(f'{name:<48}{usd(amount):>14}', 9, 'M')
    doc.rule()
    doc.text(f'{"Estimated total":<48}{usd(16600):>14}', 10, 'MB')
    doc.text('This is an estimate, not an invoice. 30% deposit on acceptance.', 9)
    return doc


def pt_boleto():
    doc = Doc(A4)
    doc.text('BANCO IPÊ   341-7', 14, 'B', right='Recibo do pagador')
    doc.text('34191.09008 61207.727308 71140.630006 1 99950000048920', 10, 'MB')
    doc.rule()
    for label, value in [('Beneficiário', 'Aluguel Imóveis Sul Ltda - CNPJ 45.112.908/0001-33'),
                         ('Pagador', 'Padaria Pão Quente ME - CNPJ 98.765.432/0001-10'),
                         ('Nosso número', '109/00061207-7'), ('Nº do documento', 'ALG-10/2026'),
                         ('Data do documento', '01/10/2026'), ('Vencimento', '10/10/2026'),
                         ('Valor do documento', 'R$ 4.892,00'),
                         ('Instruções', 'Após o vencimento cobrar multa de 2% e juros de 1% ao mês.')]:
        doc.text(f'{label + ":":<22}{value}', 9, 'M')
    doc.space(10)
    doc.text('Aluguel referente a outubro de 2026 - Rua Uruguai, 1201, Chapecó SC', 9)
    return doc


def en_subscription_receipt():
    doc = Doc()
    doc.text('Tallyhub', 18, 'B')
    doc.text('Receipt for your payment', 12, 'B', right='Receipt #TH-30418-0007')
    doc.text('Billed to: Riverbend Design LLC', 9, right='Paid on October 1, 2026')
    doc.rule()
    doc.text(f'{"Team plan, 5 seats, Oct 1 - Oct 31 2026":<48}{usd(75):>12}', 9, 'M')
    doc.text(f'{"Sales tax":<48}{usd(6.19):>12}', 9, 'M')
    doc.text(f'{"Amount paid":<48}{usd(81.19):>12}', 10, 'MB')
    doc.text('Paid with Visa ****3307', 9)
    doc.space(14)
    doc.text('Billing history', 10, 'B')
    doc.text(f'{"Sep 1, 2026":<16}{"TH-30418-0006":<20}{"Paid":<8}{usd(81.19):>12}', 8, 'M')
    doc.text(f'{"Aug 1, 2026":<16}{"TH-30418-0005":<20}{"Paid":<8}{usd(81.19):>12}', 8, 'M')
    doc.text(f'{"Jul 1, 2026":<16}{"TH-30418-0004":<20}{"Paid":<8}{usd(64.95):>12}', 8, 'M')
    return doc


def en_bank_fee_notice():
    doc = Doc()
    doc.text('HARBOR FEDERAL BANK', 16, 'B')
    doc.text('October 18, 2026', 9)
    doc.space(10)
    doc.text('Riverbend Design LLC', 10)
    doc.text('12 Mill Road, Austin TX 78704', 10)
    doc.space(10)
    doc.text('Re: Returned item fee on account ****4471', 10, 'B')
    doc.space(6)
    for line in ['Dear customer,', '',
                 'On October 17, 2026, a check deposited to your Everyday Checking account was returned unpaid',
                 'by the issuing bank. As described in our fee schedule, a returned item fee of $15.00 was',
                 'charged to your account on the same day.', '',
                 'If you have questions about this fee, please call us at 1-800-555-0144.', '',
                 'Sincerely,', 'Client Services, Harbor Federal Bank']:
        doc.text(line, 10)
    return doc


# ---------------------------------------------------------------------------------------------
# Screenshots and photos


def right_text(draw, x, y, text, text_font, fill):
    draw.text((x - draw.textlength(text, font=text_font), y), text, font=text_font, fill=fill)


def en_online_banking(path):
    rng = random.Random(31)
    image = Image.new('RGB', (1280, 900), (246, 248, 251))
    draw = ImageDraw.Draw(image)
    draw.rectangle([0, 0, 1280, 64], fill=(18, 52, 96))
    draw.text((32, 18), 'Harbor Federal Bank', font=font('B', 24), fill='white')
    draw.text((900, 22), 'Accounts   Transfers   Bill pay   Sign out', font=font('R', 16), fill=(210, 220, 235))
    draw.text((32, 92), 'Everyday Checking ...4471', font=font('B', 26), fill=(20, 20, 20))
    draw.text((32, 132), 'Available balance  $4,812.33', font=font('R', 18), fill=(60, 60, 60))
    draw.rectangle([32, 180, 1248, 220], fill=(225, 231, 240))
    for x, label in [(48, 'Date'), (190, 'Description')]:
        draw.text((x, 190), label, font=font('B', 16), fill=(40, 40, 40))
    right_text(draw, 1010, 190, 'Amount', font('B', 16), (40, 40, 40))
    right_text(draw, 1230, 190, 'Balance', font('B', 16), (40, 40, 40))
    balance = 4812.33
    y = 228
    for index, (day, description, amount) in enumerate(reversed(statement_rows(rng, 15, EN_DEBITS, EN_CREDITS, 10, 1, 24))):
        if index % 2:
            draw.rectangle([32, y - 6, 1248, y + 34], fill=(255, 255, 255))
        draw.text((48, y), f'Oct {day}, 2026', font=font('R', 16), fill=(40, 40, 40))
        draw.text((190, y), description.title(), font=font('R', 16), fill=(40, 40, 40))
        color = (20, 120, 60) if amount > 0 else (40, 40, 40)
        right_text(draw, 1010, y, ('+' if amount > 0 else '-') + '$' + usd(abs(amount)), font('R', 16), color)
        right_text(draw, 1230, y, '$' + usd(balance), font('R', 16), (90, 90, 90))
        balance -= amount
        y += 40
    image.save(path, optimize=True)


def pt_extrato_app(path):
    rng = random.Random(32)
    image = Image.new('RGB', (720, 1480), 'white')
    draw = ImageDraw.Draw(image)
    draw.text((30, 14), '10:42', font=font('B', 22), fill='black')
    draw.text((600, 14), '5G  87%', font=font('R', 20), fill='black')
    draw.rectangle([0, 56, 720, 220], fill=(0, 110, 80))
    draw.text((30, 76), '<  Extrato', font=font('B', 30), fill='white')
    draw.text((30, 136), 'Saldo disponível', font=font('R', 20), fill=(210, 240, 225))
    draw.text((30, 166), 'R$ 2.341,87', font=font('B', 30), fill='white')
    y = 250
    entries = statement_rows(rng, 16, PT_DEBITS, PT_CREDITS, 10, 3, 14)
    current = None
    for day, description, amount in reversed(entries):
        if day != current:
            current = day
            draw.text((30, y), f'{day} de outubro', font=font('B', 20), fill=(110, 110, 110))
            y += 40
        draw.text((30, y), description.title(), font=font('R', 22), fill=(30, 30, 30))
        color = (0, 130, 80) if amount > 0 else (200, 40, 40)
        right_text(draw, 690, y, ('+ ' if amount > 0 else '- ') + 'R$ ' + brl(abs(amount)), font('B', 22), color)
        y += 54
        if y > 1440:
            break
    image.convert('RGB').save(path, quality=85)


def receipt_image(lines, width, kind='M', size=18):
    height = 40 + len(lines) * (size + 9) + 40
    image = Image.new('L', (width, height), 250)
    draw = ImageDraw.Draw(image)
    y = 30
    for line in lines:
        bold = line.startswith('**')
        text = line[2:] if bold else line
        draw.text((24, y), text, font=font('MB' if bold else kind, size), fill=25)
        y += size + 9
    return image


def en_receipt_photo(path):
    receipt = receipt_image([
        '**   FUELWAY #221', '  1800 N IH-35 AUSTIN TX', '  10/12/2026  07:58', '', 'PUMP 6  UNLEADED',
        '  12.402 GAL @ 3.199', '  FUEL SALE        $39.67', 'COFFEE 16OZ        $2.29', 'GRANOLA BAR        $1.89',
        '', 'SUBTOTAL          $43.85', 'TAX                $0.34', '**TOTAL             $44.19', '',
        'MASTERCARD ****5501', 'AUTH 093341', '  THANK YOU, COME AGAIN',
    ], 430)
    photo = Image.new('L', (720, 1000), 120)
    rotated = receipt.rotate(3, resample=Image.BICUBIC, expand=True, fillcolor=120)
    photo.paste(rotated, (130, 120))
    noise = Image.frombytes('L', photo.size, random.Random(33).randbytes(photo.size[0] * photo.size[1]))
    photo = Image.blend(photo, noise, 0.06).filter(ImageFilter.GaussianBlur(1.0))
    photo.convert('RGB').save(path, quality=78)


def pt_cupom_fiscal(path):
    rng = random.Random(34)
    produtos = ['PAO FRANCES KG', 'LEITE INTEGRAL 1L', 'CAFE TORRADO 500G', 'ARROZ TIPO 1 5KG', 'FEIJAO PRETO 1KG',
                'BANANA PRATA KG', 'TOMATE KG', 'QUEIJO MUSSARELA KG', 'IOGURTE NATURAL', 'DETERGENTE 500ML',
                'PAPEL HIGIENICO 12UN', 'MACARRAO 500G', 'OLEO SOJA 900ML', 'MANTEIGA 200G', 'OVOS DZ']
    lines = ['**SUPERMERCADO BOA COMPRA', 'CNPJ 33.441.200/0001-07', 'AV. GETULIO VARGAS 1500 CHAPECO SC',
             'CUPOM FISCAL ELETRONICO - SAT', 'Nº 004521   14/10/2026 18:22', '-' * 34, 'ITEM DESCRICAO        QTD   VALOR']
    total = 0.0
    for index in range(1, 27):
        price = round(rng.uniform(2.5, 38), 2)
        quantity = rng.randint(1, 3)
        total += price * quantity
        lines.append(f'{index:03d} {rng.choice(produtos)[:17]:<17} {quantity:>2} {brl(price * quantity):>8}')
    lines += ['-' * 34, f'**TOTAL R$ {brl(total):>21}', f'CARTAO DEBITO      {brl(total):>15}', '',
              'CONSUMIDOR NAO IDENTIFICADO', 'OBRIGADO PELA PREFERENCIA']
    receipt_image(lines, 480, size=17).convert('RGB').save(path, optimize=True)


def pt_comprovante_pix(path):
    image = Image.new('RGB', (720, 1280), 'white')
    draw = ImageDraw.Draw(image)
    draw.rectangle([0, 0, 720, 120], fill=(0, 110, 80))
    draw.text((30, 40), 'Banco Ipê', font=font('B', 34), fill='white')
    draw.text((30, 160), 'Comprovante de Pix', font=font('B', 34), fill=(20, 20, 20))
    draw.text((30, 220), 'Valor', font=font('R', 22), fill=(110, 110, 110))
    draw.text((30, 252), 'R$ 350,00', font=font('B', 40), fill=(20, 20, 20))
    y = 340
    for label, value in [('Data e hora', '14/10/2026 às 10:42'), ('Para', 'Oficina Rocha Ltda'),
                         ('CNPJ', '27.330.114/0001-52'), ('Instituição', 'Banco Serrano S.A.'),
                         ('Chave Pix', 'financeiro@oficinarocha.example'), ('De', 'Padaria Pão Quente ME'),
                         ('Descrição', 'Revisão do furgão'), ('ID da transação', 'E31872495202610141042a7Kq88Pd')]:
        draw.text((30, y), label, font=font('R', 20), fill=(110, 110, 110))
        draw.text((30, y + 30), value, font=font('B', 24), fill=(20, 20, 20))
        y += 96
    image.save(path, optimize=True)


def en_chat_payment(path):
    image = Image.new('RGB', (720, 1100), (236, 229, 221))
    draw = ImageDraw.Draw(image)
    draw.rectangle([0, 0, 720, 100], fill=(7, 94, 84))
    draw.text((30, 34), 'Dana Whitfield', font=font('B', 28), fill='white')

    def bubble(y, text_lines, mine):
        width = max(draw.textlength(line, font=font('R', 22)) for line in text_lines) + 40
        x = 690 - width if mine else 30
        draw.rounded_rectangle([x, y, x + width, y + 20 + 32 * len(text_lines)], 14, fill=(220, 248, 198) if mine else 'white')
        for index, line in enumerate(text_lines):
            draw.text((x + 20, y + 12 + 32 * index), line, font=font('R', 22), fill=(20, 20, 20))
        return y + 40 + 32 * len(text_lines)

    y = bubble(140, ['Hey! Did you get the tickets', 'for Saturday?'], False)
    y = bubble(y, ['Yes, two seats, $45 each'], True)
    y = bubble(y, ['Great, sending my half now'], False)
    draw.rounded_rectangle([30, y, 470, y + 150], 14, fill='white')
    draw.text((50, y + 16), 'Payment received', font=font('R', 20), fill=(110, 110, 110))
    draw.text((50, y + 48), '$45.00', font=font('B', 38), fill=(20, 20, 20))
    draw.text((50, y + 104), 'Concert tickets - Oct 18', font=font('R', 20), fill=(60, 60, 60))
    bubble(y + 180, ['Got it, thanks!'], True)
    image.save(path, optimize=True)


def main():
    write_pdf(en_bank_statement(1, 18), 'en-bank-statement.pdf')
    write_pdf(en_bank_statement(2, 120, bank='Summit Valley Credit Union', title='Business Checking',
                                address='1200 Ridge Road, Boulder CO 80302  |  summitvalley.example'), 'en-bank-statement-3-pages.pdf')
    write_pdf(en_bank_statement(3, 560), 'en-bank-statement-10-pages.pdf')
    write_pdf(en_card_statement(), 'en-card-statement.pdf')
    write_pdf(pt_extrato(5, 22), 'pt-extrato-bancario.pdf')
    write_pdf(pt_fatura_cartao(), 'pt-fatura-cartao.pdf')
    write_pdf(en_quiet_statement(), 'en-statement-two-rows.pdf')
    write_pdf(en_payment_platform_activity(), 'en-payment-platform-activity.pdf')
    write_scan(en_bank_statement(7, 20), 'en-bank-statement-scan.pdf', seed=7)
    write_scan(pt_extrato(8, 70), 'pt-extrato-scan.pdf', seed=8, angle=-0.4)
    write_scan(en_card_statement(), 'en-card-statement-scan.pdf', seed=9, angle=0.3)
    en_online_banking('en-online-banking.png')
    pt_extrato_app('pt-extrato-app.jpg')

    write_pdf(en_invoice(), 'en-invoice.pdf')
    write_pdf(en_timesheet_invoice(), 'en-invoice-timesheet.pdf')
    write_pdf(en_two_page_invoice(), 'en-invoice-2-pages.pdf')
    write_pdf(pt_nota_fiscal(), 'pt-nota-fiscal.pdf')
    write_pdf(pt_fatura_telefonia(), 'pt-fatura-telefonia.pdf')
    write_pdf(en_utility_bill(), 'en-utility-bill.pdf')
    write_pdf(en_hotel_folio(), 'en-hotel-folio.pdf')
    write_pdf(en_transfer_confirmation(), 'en-transfer-confirmation.pdf')
    write_pdf(en_quote(), 'en-quote.pdf')
    write_pdf(pt_boleto(), 'pt-boleto.pdf')
    write_pdf(en_subscription_receipt(), 'en-subscription-receipt.pdf')
    write_pdf(en_bank_fee_notice(), 'en-bank-fee-notice.pdf')
    write_scan(en_invoice_short(), 'en-invoice-scan.pdf', seed=41)
    write_scan(en_receipt_doc(), 'en-receipt-scan.pdf', seed=42, angle=1.2)
    write_scan(en_utility_bill(), 'en-utility-bill-scan.pdf', seed=43, angle=-0.6)
    en_receipt_photo('en-receipt-photo.jpg')
    pt_cupom_fiscal('pt-cupom-fiscal.png')
    pt_comprovante_pix('pt-comprovante-pix.png')
    en_chat_payment('en-chat-payment.png')


if __name__ == '__main__':
    main()
