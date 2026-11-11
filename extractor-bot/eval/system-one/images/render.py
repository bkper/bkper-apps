"""Renders the synthetic scanned documents of the extraction trial.

Run from this directory with Pillow and the DejaVu fonts installed:

    python3 render.py

Every business, person and number is invented. Expected values are in ../cases.ts.
"""

from PIL import Image, ImageDraw, ImageFont

FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'

DOCUMENTS = {
    'en-grocery-receipt.png': [
        '**GREENLEAF MARKET',
        '501 Cedar Blvd, Austin TX',
        'Receipt #GL-20931',
        '09/18/2026  6:41 PM',
        '',
        'Organic bananas       $2.49',
        'Greek yogurt 32oz     $6.99',
        'Sourdough loaf        $5.50',
        'Spinach bag           $3.99',
        'SUBTOTAL             $18.97',
        'TAX                   $0.00',
        '**TOTAL                $18.97',
        'VISA ************4410',
    ],
    'pt-farmacia.jpg': [
        '**FARMÁCIA BOA SAÚDE',
        'Av. Brasil 2200 - Rio de Janeiro RJ',
        'CUPOM 552871   03/10/2026 10:15',
        '',
        'DIPIRONA 500MG 10CP     R$ 6,90',
        'PROTETOR SOLAR FPS50    R$ 54,90',
        'ESCOVA DENTAL MACIA     R$ 12,40',
        '**TOTAL                   R$ 74,20',
        'PIX                     R$ 74,20',
    ],
    'en-invoice-no-date.png': [
        '**NORTHFIELD SIGN CO.',
        '**INVOICE  NSC-1554',
        '',
        'Bill to: Tern & Finch Design LLC',
        '',
        'Vinyl window lettering        $320.00',
        'Installation (2 hrs)          $140.00',
        '**TOTAL DUE                     $460.00',
        '',
        'Thank you for your business!',
    ],
    'pt-servico-eletrica.png': [
        '**ELÉTRICA LUZ FORTE',
        'Nota de serviço nº 2077',
        'Data: 21/09/2026',
        '',
        'Instalação de 4 tomadas     R$ 320,00',
        'Troca de disjuntor          R$ 95,00',
        'Desconto                   -R$ 30,00',
        '**TOTAL                     R$ 385,00',
    ],
}


def render(lines):
    """Black monospaced text on white; lines starting with ** are bold."""
    size = 22
    regular = ImageFont.truetype(FONT, size)
    bold = ImageFont.truetype(BOLD, size)
    width = 40 + max(len(line) for line in lines) * 14
    height = 40 + len(lines) * 32
    image = Image.new('L', (width, height), 255)
    draw = ImageDraw.Draw(image)
    for index, line in enumerate(lines):
        font = bold if line.startswith('**') else regular
        draw.text((20, 20 + index * 32), line.removeprefix('**'), fill=0, font=font)
    return image


if __name__ == '__main__':
    for name, lines in DOCUMENTS.items():
        image = render(lines)
        if name.endswith('.jpg'):
            image.save(name, quality=85)
        else:
            image.save(name, optimize=True)
        print(name, image.size)
