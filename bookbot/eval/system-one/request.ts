import type { DiscoveryCase } from './cases.js';
import type { SystemOneRequest } from './contract.js';

/** Question names in every request; answers come back under the same names. */
export const ACCOUNT_QUESTION = 'account';
export const FITS_QUESTION = 'fits';

const TYPE_LABELS = {
    ASSET: 'Asset',
    LIABILITY: 'Liability',
    INCOMING: 'Incoming',
    OUTGOING: 'Outgoing',
} as const;

/**
 * One request per case and model, asking both decisions discovery makes: whether any Account
 * of the Book is the other side of the bank line (`noul`), and which one (`choice`). The candidates
 * are every Account of the Book except the known bank Account, described only by what a Book
 * already holds: name, type and group.
 */
export function buildRequest(model: string, discoveryCase: DiscoveryCase): SystemOneRequest {
    const candidates = discoveryCase.book.accounts.filter(account => account.name !== discoveryCase.book.bankAccount);
    const criteria: Record<string, string> = {};
    for (const account of candidates) {
        criteria[account.name] = `${TYPE_LABELS[account.type]} Account in group ${account.group}`;
    }
    const direction = discoveryCase.direction === 'out' ? 'money out of' : 'money into';
    const state = [
        `Bank account: ${discoveryCase.book.bankAccount}`,
        `Direction: ${direction} the bank account`,
        `Amount: ${discoveryCase.amount}`,
        `Description: ${discoveryCase.description}`,
    ].join('\n');

    return {
        model,
        state,
        questions: {
            [FITS_QUESTION]: {
                type: 'noul',
                instructions: `Is one of these Accounts the other side of this bank transaction: ${candidates.map(account => account.name).join(', ')}?`,
                criteria: {
                    true: 'The merchant, payer or purpose clearly matches one of the listed Accounts.',
                    false: 'None of the listed Accounts matches; a bookkeeper would need another Account or more information.',
                },
            },
            [ACCOUNT_QUESTION]: {
                type: 'choice',
                instructions: 'Which Account is the other side of this bank transaction: where the money went to, or where it came from?',
                criteria,
            },
        },
    };
}
