/**
 * Shows how real Jev ranks the suggestions of real Books, read-only:
 *
 *     npx tsx scripts/eval-suggestions.ts <bookId>...
 *
 * For each Book it loads the map with your `bkper auth token`, asks Jev the one question that
 * ranks its candidates (`suggestion-questions.ts`), and prints every candidate with its
 * probability, then the three suggestions Report would show, the first opening by itself. No
 * balances are read and nothing is remembered, so each run asks again. Jev calls use
 * `BKPER_AI_TOKEN` when set, else the same token, labelled `bkper-ai-source:
 * report-eval-suggestions`; Bkper AI caches identical requests for 15 minutes.
 */
import { execFileSync } from 'node:child_process';
import { Bkper } from 'bkper-js';
import { createDecisionClient, decide } from '../server/src/services/decision-client.ts';
import {
    currentUserId,
    loadSnapshot,
    type SnapshotStore,
} from '../server/src/services/snapshot-loader.ts';
import { buildSuggestionRequest } from '../server/src/services/suggestion-questions.ts';
import {
    buildSuggestions,
    rankedIds,
    suggestionCandidates,
} from '../server/src/services/suggestions.ts';
import { ServerTiming } from '../server/src/services/timing.ts';

class MemoryStore implements SnapshotStore {
    private readonly values = new Map<string, string>();
    async get(key: string): Promise<string | null> {
        return this.values.get(key) ?? null;
    }
    async put(key: string, value: string): Promise<void> {
        this.values.set(key, value);
    }
}

async function main(): Promise<void> {
    const books = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
    if (books.length === 0) {
        throw new Error('Name at least one Book id');
    }
    const bkperToken = execFileSync('bkper', ['auth', 'token'], { encoding: 'utf8' }).trim();
    const bkper = new Bkper({ oauthTokenProvider: async () => bkperToken });
    const client = createDecisionClient({
        apiKey: process.env.BKPER_AI_TOKEN || bkperToken,
        headers: { 'bkper-ai-source': 'report-eval-suggestions' },
    });
    const userId = await currentUserId(bkper, new ServerTiming());
    const kv = new MemoryStore();

    for (const bookId of books) {
        const snapshot = await loadSnapshot(bookId, {
            userId,
            bkper,
            kv,
            timing: new ServerTiming(),
        });
        const candidates = suggestionCandidates(snapshot);
        console.log(`\n${snapshot.book.name} (${bookId}): ${candidates.length} candidates`);
        if (candidates.length < 2) {
            console.log(buildSuggestions(snapshot, 'en').map(suggestion => suggestion.text));
            continue;
        }
        const { request, options } = buildSuggestionRequest(snapshot, candidates);
        const started = performance.now();
        const { answers, usage } = await decide(client, request);
        const ms = Math.round(performance.now() - started);
        const { probabilities } = answers.first;
        const order = rankedIds(options, probabilities);
        const labels = new Map(options.map(option => [option.id, option.label]));
        for (const id of order) {
            const chance = (probabilities[labels.get(id) ?? ''] ?? 0).toFixed(3);
            console.log(`  ${chance}  ${labels.get(id)}`);
        }
        console.log(`  ${ms} ms, ${usage.input_tokens} input tokens`);
        buildSuggestions(snapshot, 'en', order).forEach((suggestion, index) =>
            console.log(`  ${index + 1}. ${suggestion.text}`)
        );
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
