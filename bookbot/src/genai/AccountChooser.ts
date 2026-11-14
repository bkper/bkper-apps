import { APIConnectionError, APIError, TypeSafeClient, type Fetch } from '@typesafe-ai/sdk';
import { BkperAIClientError, isRecord } from './BkperAIClientError.js';
import { ACCOUNT_CHOICE_QUESTION, type AccountChoiceAnswer, type AccountChoiceRequest } from '../services/AccountChoice.js';

const DEFAULT_BASE_URL = 'https://ai.bkper.app';
const MODEL = 'jev';
// Bkper Platform outbound replaces this with the authorization of the current user or event,
// so Bookbot never reads or forwards a credential.
const PLATFORM_AUTHORIZATION_PLACEHOLDER = 'bkper-platform-outbound';

export interface AccountChooserOptions {
    /** Bkper AI root, with or without `/v1`: the SDK calls `/v1/systemone`. */
    baseUrl?: string;
    signal?: AbortSignal;
    fetch?: Fetch;
}

/** Asks Jev which option fills the draft's empty sides. The answer is a judgment; discovery decides. */
export class AccountChooser {
    private readonly client: TypeSafeClient;
    private readonly signal?: AbortSignal;

    constructor(options: AccountChooserOptions = {}) {
        const fetcher = options.fetch;
        this.signal = options.signal;
        this.client = new TypeSafeClient({
            apiKey: PLATFORM_AUTHORIZATION_PLACEHOLDER,
            baseURL: new URL(options.baseUrl ?? DEFAULT_BASE_URL).origin,
            defaultModel: MODEL,
            defaultHeaders: { 'bkper-ai-source': 'bookbot' },
            // The SDK calls fetch as its own method, which Workers reject with a foreign receiver.
            ...(fetcher ? { fetch: (input: string, init?: RequestInit) => fetcher(input, init) } : {}),
        });
    }

    async choose(request: AccountChoiceRequest): Promise<AccountChoiceAnswer> {
        try {
            const { model, answers } = await this.client.systemOne(request, { signal: this.signal });
            const answer = answers[ACCOUNT_CHOICE_QUESTION];
            // Counts and scores only: never log descriptions, Accounts or other Book data.
            console.log('BOOKBOT_ACCOUNT_CHOICE', JSON.stringify({
                model,
                options: Object.keys(request.questions[ACCOUNT_CHOICE_QUESTION].criteria).length,
                confidence: answer.confidence,
            }));
            return { choice: answer.choice, confidence: answer.confidence };
        } catch (error) {
            if (error instanceof APIError) {
                const body = isRecord(error.body) && isRecord(error.body.error) ? error.body.error : undefined;
                throw new BkperAIClientError(
                    error.status,
                    typeof body?.code === 'string' ? body.code : 'bkper_ai_error',
                    typeof body?.message === 'string' ? body.message : `Bkper AI returned an error (${error.status}).`,
                    false
                );
            }
            if (error instanceof APIConnectionError) {
                throw new BkperAIClientError(502, 'connection_error', 'Bkper AI could not be reached.', false);
            }
            throw error;
        }
    }
}
