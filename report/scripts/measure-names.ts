/**
 * Times completing names as a request is typed, on made-up Books of 1,000, 10,000 and 25,000
 * names: building the index once, and every keystroke of typed requests, each completed at its
 * end, as each keystroke leaves it. Nothing is read from a Book or the network.
 *
 *     npx tsx scripts/measure-names.ts [--sizes=1000,10000,25000] [--requests=200]
 *
 * Names mix languages, accents, scripts written without spaces and right to left, and several
 * words, like those of real Books; a fifth are groups. Requests write a name, part of a name or
 * just two letters, so some keystrokes match many names. A second Book of each size names
 * everything alike (`Conta corrente <n>`), so every keystroke matches every name: the worst case.
 */
import { NameIndex, type BookName } from '../shared/src/name-index.ts';

const WORDS = [
    'Despesas',
    'Refeições',
    'Água',
    'Energia',
    'Aluguel',
    'Conta',
    'corrente',
    'Cartão',
    'crédito',
    'Импорт',
    'Налоги',
    'Salários',
    'Fornecedor',
    'Café',
    'Ônibus',
    'Financiamento',
    'Seguro',
    'Rent',
    'Food',
    'Travel',
    'Office',
    'Supplies',
    'Marketing',
    'Bank',
    'Fees',
    'Taxes',
    'Investimentos',
    'Dívidas',
    'Empréstimo',
    'Ações',
    'Fundos',
    'Poupança',
    'Cliente',
    'Projeto',
    '費用',
    '食費',
    '交通費',
    '工资',
    '收入',
    'المصروفات',
    'الرواتب',
    'الإيجار',
    'Émission',
    'Größe',
    'Ελλάδα',
    'Λογαριασμός',
    'Nhà',
    'Tiền',
    'điện',
    'İstanbul',
    'Şirket',
    'Ürün',
];

/** A deterministic pseudo-random number generator, so every run measures the same Books. */
function random(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
        return state / 2_147_483_648;
    };
}

function alikeNames(size: number): BookName[] {
    return Array.from({ length: size }, (_, i) => ({
        id: `a${i}`,
        name: `Conta corrente ${i}`,
        kind: 'account',
        root: 'g0',
    }));
}

function madeUpNames(size: number): BookName[] {
    const next = random(size);
    const pick = () => WORDS[Math.floor(next() * WORDS.length)];
    const names: BookName[] = [];
    let root = 'g0';
    for (let i = 0; i < size; i++) {
        const words = Array.from({ length: 1 + Math.floor(next() * 3) }, pick);
        // Numbered like real large Books, so every name is its own.
        const name = `${words.join(' ')} ${i}`;
        const group = i % 5 === 0;
        const id = `${group ? 'g' : 'a'}${i}`;
        if (group && i % 50 === 0) root = id;
        names.push({ id, name, kind: group ? 'group' : 'account', root });
    }
    return names;
}

function percentile(sorted: number[], p: number): number {
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];
}

function option(name: string, fallback: string): string {
    const prefix = `--${name}=`;
    return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const sizes = option('sizes', '1000,10000,25000').split(',').map(Number);
const requestCount = Number(option('requests', '200'));

for (const [size, alike] of sizes.flatMap(
    size =>
        [
            [size, false],
            [size, true],
        ] as const
)) {
    const names = alike ? alikeNames(size) : madeUpNames(size);
    const started = performance.now();
    const index = new NameIndex(names);
    const build = performance.now() - started;

    const next = random(7);
    const timings: number[] = [];
    let offered = 0;
    for (let r = 0; r < requestCount; r++) {
        const name = names[Math.floor(next() * names.length)].name;
        const written = [...name];
        const typed = [
            name,
            written.slice(0, Math.max(2, Math.floor(written.length / 2))).join(''),
            written.slice(0, 2).join(''),
        ][r % 3];
        const request = `despesas de ${typed.toLowerCase()} em 2026`;
        for (let caret = 1; caret <= request.length; caret++) {
            const t0 = performance.now();
            offered += index.complete(request.slice(0, caret), caret).length;
            timings.push(performance.now() - t0);
        }
    }
    timings.sort((a, b) => a - b);
    const ms = (value: number) => `${value.toFixed(2)} ms`;
    console.log(
        [
            `${size.toLocaleString('en')} names${alike ? ' alike' : ''}`,
            `index ${ms(build)}`,
            `${timings.length} keystrokes: p50 ${ms(percentile(timings, 50))}`,
            `p95 ${ms(percentile(timings, 95))}`,
            `max ${ms(timings[timings.length - 1])}`,
            `${(offered / timings.length).toFixed(1)} offered on average`,
        ].join(' · ')
    );
}
