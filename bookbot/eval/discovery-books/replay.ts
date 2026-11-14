/** Replays Bookbot's real discovery on one frozen case and scores what it suggested. */
import { Bkper, Transaction } from 'bkper-js';

import { Discovery } from '../../src/services/DiscoveryService.js';
import { ACCOUNT_CHOICE_QUESTION } from '../../src/services/AccountChoice.js';
import {
    EvalContext,
    FrozenBook,
    FrozenDescriptionParts,
    MissingSnapshotError,
    parseSearch,
    RecordedAccountChooser,
    type BookSnapshot,
    type EvalCase,
    type JevAnswer,
    type JevCall,
} from './frozen.js';
import { verdictOf, type CaseResult, type Decision } from './score.js';

/** Replays never read a Book: any attempt to reach the Bkper API fails here. */
const OFFLINE_BKPER = new Bkper({
    oauthTokenProvider: async () => {
        throw new Error('A replay must not call the Bkper API.');
    },
});

export interface ReplayOptions {
    recording: Map<string, JevAnswer>;
    /** Ask Jev for requests not in the recording. */
    live?: { token: () => string };
}

export async function replayCase(snapshot: BookSnapshot, evalCase: EvalCase, options: ReplayOptions): Promise<CaseResult & { missing?: boolean }> {
    const book = new FrozenBook(snapshot, evalCase);
    const jevCalls: JevCall[] = [];
    const errors: unknown[] = [];
    const context = new EvalContext(
        OFFLINE_BKPER,
        () => new FrozenDescriptionParts(snapshot.descriptionParts),
        () => new RecordedAccountChooser(options.recording, options.live, (request, answer) => {
            jevCalls.push({ afterQueries: book.queries.length, options: Object.keys(request.questions[ACCOUNT_CHOICE_QUESTION].criteria).length, answer });
        }),
    );
    const draft = new Transaction(book, structuredClone(evalCase.draft));
    const expectedSide = evalCase.draft.creditAccount?.id ? 'debitAccount' : 'creditAccount';

    // Failed searches are part of the frozen history and end as no match, like the deployed app.
    const isRecordedSearchFailure = (error: unknown) => error instanceof Error && !(error instanceof MissingSnapshotError)
        && Object.values(evalCase.searches).some(search => !Array.isArray(search) && search.error === error.message);
    const { discovered } = await new Discovery(context, error => {
        if (!isRecordedSearchFailure(error)) errors.push(error);
    }).discover(draft);

    const suggestedAccountId = discovered ? draft.payload[expectedSide]?.id : undefined;
    let decision: Decision | undefined;
    if (discovered) {
        const deciding = book.queries.length;
        const jevCall = jevCalls.find(call => call.afterQueries === deciding);
        decision = {
            ...parseSearch(book.queries[deciding - 1], evalCase.draft),
            options: jevCall?.options ?? 1,
            confidence: jevCall?.answer.confidence ?? 1,
        };
    }
    const error = errors[0];
    return {
        book: snapshot.label,
        caseId: evalCase.id,
        expectedAccountId: evalCase.expectedAccountId,
        ...(suggestedAccountId ? { suggestedAccountId } : {}),
        verdict: verdictOf(evalCase.expectedAccountId, suggestedAccountId),
        ...(decision ? { decision } : {}),
        ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
        ...(errors.some(item => item instanceof MissingSnapshotError) ? { missing: true } : {}),
    };
}
