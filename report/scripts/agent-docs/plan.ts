/**
 * Judges what an agent plans to run for a person's report request: the call the Report docs
 * should lead it to, `bkper app api request report /api/v1/books/<bookId>/report` with
 * `{"prompt": <the request in its own words>, "format": "html"}`, saved to an `.html` file that
 * it publishes, and nothing that changes the Book.
 */

/** What the agent would do: shell commands in order, and the files it would publish. */
export interface AgentPlan {
    commands: string[];
    publish: string[];
}

/** Subcommands of `bkper <resource>` that change a Book or its Apps. */
const WRITE_VERBS = new Set([
    'create',
    'update',
    'delete',
    'remove',
    'trash',
    'untrash',
    'check',
    'uncheck',
    'post',
    'merge',
    'install',
    'uninstall',
    'replay',
]);

/** The share of the prompt's words that must come from the request: it may shorten it, never translate it. */
const MIN_SHARED_WORDS = 0.5;

/** The problems of a plan; none when it is the expected one. */
export function judgePlan(plan: AgentPlan, bookId: string, request: string): string[] {
    const problems = plan.commands
        .map(shellWords)
        .filter(words => words[0] === 'bkper' && WRITE_VERBS.has(words[2] ?? ''))
        .map(words => `changes the Book: ${words.join(' ')}`);

    const path = `/api/v1/books/${bookId}/report`;
    const call = plan.commands
        .map(shellWords)
        .find(words => words.slice(0, 6).join(' ') === `bkper app api request report ${path}`);
    if (!call) {
        return [...problems, `no \`bkper app api request report ${path}\` command`];
    }

    const body = parseBody(call);
    if (!body) {
        problems.push('no JSON object body in -d');
    } else {
        if (body.format !== 'html')
            problems.push(`the body asks for format ${body.format}, not html`);
        if (typeof body.prompt !== 'string') {
            problems.push('the body has no prompt');
        } else if (wordsFrom(request, body.prompt) < MIN_SHARED_WORDS) {
            problems.push(`the prompt is not the request in its own words: "${body.prompt}"`);
        }
        if (body.intent !== undefined) problems.push('the body sends an intent with the prompt');
    }

    const file = outputFile(call);
    if (!file?.endsWith('.html')) problems.push('the response is not saved to an .html file');
    const published = plan.publish.filter(name => name.endsWith('.html'));
    if (published.length === 0) {
        problems.push('publishes no .html file');
    } else if (file && !published.some(name => sameFile(name, file))) {
        problems.push(`does not publish ${file}`);
    }
    return problems;
}

/** The words of a shell command, with quotes and escapes resolved as a POSIX shell does. */
export function shellWords(command: string): string[] {
    const words: string[] = [];
    let word: string | undefined;
    let quote: "'" | '"' | undefined;
    for (let i = 0; i < command.length; i++) {
        const char = command[i];
        if (quote === "'") {
            if (char === "'") quote = undefined;
            else word += char;
        } else if (quote === '"') {
            if (char === '"') quote = undefined;
            else if (char === '\\' && i + 1 < command.length && '"\\$`'.includes(command[i + 1]))
                word += command[++i];
            else word += char;
        } else if (/\s/.test(char)) {
            if (word !== undefined) words.push(word);
            word = undefined;
        } else if (char === "'" || char === '"') {
            quote = char;
            word ??= '';
        } else if (char === '\\' && i + 1 < command.length) {
            word = (word ?? '') + command[++i];
        } else if (char === '>' && word !== undefined) {
            words.push(word);
            word = '>';
        } else {
            word = (word ?? '') + char;
        }
    }
    if (word !== undefined) words.push(word);
    return words;
}

function parseBody(words: string[]): Record<string, unknown> | undefined {
    const index = words.findIndex(word => word === '-d' || word === '--data');
    const inline = words.find(word => word.startsWith('--data='));
    const data = index >= 0 ? words[index + 1] : inline?.slice('--data='.length);
    if (data === undefined) return undefined;
    try {
        const value: unknown = JSON.parse(data);
        return typeof value === 'object' && value !== null && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : undefined;
    } catch {
        return undefined;
    }
}

/** Where `> file` sends the command's output. */
function outputFile(words: string[]): string | undefined {
    const index = words.findIndex(word => word.startsWith('>'));
    if (index < 0) return undefined;
    const target = words[index].slice(1);
    return target || words[index + 1];
}

function sameFile(a: string, b: string): boolean {
    const base = (path: string) => path.split('/').pop();
    return a === b || base(a) === base(b);
}

/** The share of the prompt's words that the request has. */
function wordsFrom(request: string, prompt: string): number {
    const promptWords = words(prompt);
    if (promptWords.length === 0) return 0;
    const requestWords = new Set(words(request));
    return promptWords.filter(word => requestWords.has(word)).length / promptWords.length;
}

function words(text: string): string[] {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    return [...segmenter.segment(text.toLocaleLowerCase())]
        .filter(segment => segment.isWordLike)
        .map(segment => segment.segment);
}
