import type { ChoiceQuestion, JsonValue } from '@typesafe-ai/sdk';
import { Account, Transaction } from 'bkper-js';
import {
    BOOKBOT_CREDIT_ACCOUNT_ID_PROPERTY,
    BOOKBOT_DEBIT_ACCOUNT_ID_PROPERTY,
    LEGACY_AGENT_CREDIT_ACCOUNT_ID_PROPERTY,
    LEGACY_AGENT_DEBIT_ACCOUNT_ID_PROPERTY,
} from '../constants.js';

export const ACCOUNT_CHOICE_QUESTION = 'account';

const APP_PROPERTY_PREFIXES = ['bookbot_', 'agent_', 'extractor_'];
const MAX_TEXT_CHARACTERS = 200;
const MAX_GROUP_NAMES = 5;
/** Payments shift around weekends and holidays, so nearby days of the month count as the same. */
const DAY_OF_MONTH_WINDOW = 3;
const MAX_PROPERTY_VALUE_CHARACTERS = 256;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const INSTRUCTIONS = [
    'The draft is a transaction that moves an amount from one Account to another, with one or both Accounts missing.',
    'Posted transactions of this Book that match the draft\'s description were recorded with different Accounts; each option fills the missing Accounts the way some of them did.',
    'History lists those transactions per option, most recent first, with facts comparing their amounts and days of the month with the draft\'s, counting days up to 3 apart as the same.',
    'Which option fills the draft the way this Book records this operation?',
    'Tell the options apart by amount, day of month, weekday, month, hashtags and properties; when nothing tells them apart, prefer the option used most often and most recently.',
].join(' ');

/** One way to fill the draft's empty sides, with the posted transactions that used it. */
export interface AccountOption {
    label: string;
    creditAccount?: bkper.Account;
    debitAccount?: bkper.Account;
    transactions: Transaction[];
}

type JsonObject = { [key: string]: JsonValue };

export interface AccountChoiceRequest {
    state: JsonObject;
    questions: { [ACCOUNT_CHOICE_QUESTION]: ChoiceQuestion };
}

export interface AccountChoiceAnswer {
    choice: string;
    confidence: number;
}

export interface AccountChoiceDecision {
    option: AccountOption;
    confidence: number;
}

function accountName(account: bkper.Account): string {
    return account.name || account.id || '';
}

/**
 * Groups posted transactions by the Accounts they would put on the draft's empty sides, in order
 * of first appearance. Options the draft cannot take are left out: an Account already on the
 * other side, or the Account Bookbot suggested before on that side and the user corrected.
 */
export function collectAccountOptions(draft: Transaction, dataset: Transaction[]): AccountOption[] {
    const knownCreditId = draft.payload.creditAccount?.id;
    const knownDebitId = draft.payload.debitAccount?.id;
    if (knownCreditId && knownDebitId) {
        return [];
    }
    const blockedCreditId = draft.getProperty(BOOKBOT_CREDIT_ACCOUNT_ID_PROPERTY, LEGACY_AGENT_CREDIT_ACCOUNT_ID_PROPERTY);
    const blockedDebitId = draft.getProperty(BOOKBOT_DEBIT_ACCOUNT_ID_PROPERTY, LEGACY_AGENT_DEBIT_ACCOUNT_ID_PROPERTY);

    const options = new Map<string, AccountOption>();
    for (const transaction of dataset) {
        const credit = transaction.payload.creditAccount;
        const debit = transaction.payload.debitAccount;
        let key: string;
        let option: Omit<AccountOption, 'transactions'>;
        if (knownCreditId) {
            if (!debit?.id || debit.id === knownCreditId || debit.id === blockedDebitId) continue;
            key = `debit:${debit.id}`;
            option = { label: `To: ${accountName(debit)}`, debitAccount: debit };
        } else if (knownDebitId) {
            if (!credit?.id || credit.id === knownDebitId || credit.id === blockedCreditId) continue;
            key = `credit:${credit.id}`;
            option = { label: `From: ${accountName(credit)}`, creditAccount: credit };
        } else {
            if (!credit?.id || !debit?.id || credit.id === debit.id) continue;
            if (credit.id === blockedCreditId || debit.id === blockedDebitId) continue;
            key = `${credit.id}:${debit.id}`;
            option = { label: `${accountName(credit)} → ${accountName(debit)}`, creditAccount: credit, debitAccount: debit };
        }
        const existing = options.get(key);
        if (existing) {
            existing.transactions.push(transaction);
        } else {
            options.set(key, { ...option, transactions: [transaction] });
        }
    }
    return [...options.values()];
}

function truncate(text: string, maxCharacters: number): string {
    return text.length > maxCharacters ? `${text.slice(0, maxCharacters)}…` : text;
}

function operationProperties(properties: bkper.Transaction['properties']): JsonObject | undefined {
    const result: JsonObject = {};
    for (const [key, value] of Object.entries(properties ?? {})) {
        const lowerKey = key.toLowerCase();
        if (value == null || key.endsWith('_') || APP_PROPERTY_PREFIXES.some(prefix => lowerKey.startsWith(prefix))) continue;
        result[key] = truncate(String(value), MAX_PROPERTY_VALUE_CHARACTERS);
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

function parseDate(date: string | undefined): { year: number; month: number; day: number } | undefined {
    const match = date ? /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date) : null;
    return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : undefined;
}

function dateFacts(date: string | undefined): JsonObject {
    const parsed = parseDate(date);
    if (!date || !parsed) return {};
    const weekday = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
    return { date, day_of_month: parsed.day, weekday: WEEKDAYS[weekday], month: MONTHS[parsed.month - 1] };
}

/** The facts of a transaction that describe its operation, computed by code for the model to compare. */
function transactionFacts(payload: bkper.Transaction, from: string | undefined, to: string | undefined): JsonObject {
    const facts: JsonObject = {
        description: truncate(payload.description ?? '', MAX_TEXT_CHARACTERS),
    };
    const amount = Number(payload.amount);
    if (payload.amount != null && Number.isFinite(amount)) facts.amount = amount;
    Object.assign(facts, dateFacts(payload.date));
    // Bkper AI rejects null values, so an unknown side is left out.
    if (from) facts.from = from;
    if (to) facts.to = to;
    if (payload.tags?.length) facts.hashtags = payload.tags;
    const properties = operationProperties(payload.properties);
    if (properties) facts.properties = properties;
    return facts;
}

function knownName(side: bkper.Account | undefined, knownAccount: Account | undefined): string | undefined {
    if (!side?.id) return undefined;
    if (knownAccount && knownAccount.getId() === side.id) return knownAccount.getName() ?? side.name;
    return side.name;
}

/** Comparisons of an option's past transactions with the draft, computed by code instead of the model. */
function optionFacts(draft: bkper.Transaction, option: AccountOption): JsonObject {
    const draftAmount = Number(draft.amount);
    const draftDay = parseDate(draft.date)?.day;
    const pasts = option.transactions.map(transaction => transaction.json());
    const amounts = pasts.map(past => Number(past.amount)).filter(amount => Number.isFinite(amount));
    const facts: JsonObject = { past_transactions: pasts.length };
    if (amounts.length > 0) {
        facts.amount_min = Math.min(...amounts);
        facts.amount_max = Math.max(...amounts);
    }
    if (draft.amount != null && Number.isFinite(draftAmount)) {
        facts.with_same_amount = amounts.filter(amount => amount === draftAmount).length;
    }
    if (draftDay !== undefined) {
        facts.with_day_of_month_within_3_days = pasts.filter(past => {
            const day = parseDate(past.date)?.day;
            return day !== undefined && Math.abs(day - draftDay) <= DAY_OF_MONTH_WINDOW;
        }).length;
    }
    return facts;
}

function accountDescription(account: bkper.Account): string {
    const groups = (account.groups ?? [])
        .filter(group => !group.hidden)
        .map(group => group.name)
        .filter((name): name is string => !!name)
        .slice(0, MAX_GROUP_NAMES);
    const details = [
        ...(account.type ? [account.type.charAt(0) + account.type.slice(1).toLowerCase()] : []),
        ...(groups.length ? [`groups: ${groups.join(', ')}`] : []),
    ];
    return details.length ? `${accountName(account)} (${details.join('; ')})` : accountName(account);
}

function optionDescription(option: AccountOption): string {
    if (option.creditAccount && option.debitAccount) {
        return `From ${accountDescription(option.creditAccount)} to ${accountDescription(option.debitAccount)}`;
    }
    if (option.creditAccount) return `From ${accountDescription(option.creditAccount)}`;
    return `To ${accountDescription(option.debitAccount!)}`;
}

/**
 * The System One request: one `choice` over the options and "None of these", with the draft and
 * each option's facts and past transactions in the state. `knownAccount` names a known side the
 * draft holds only by ID. Accounts are named and described by type and visible groups, so the
 * transactions must carry loaded Accounts: listed transactions carry only their Accounts' IDs.
 */
export function buildAccountChoiceRequest(draft: Transaction, options: AccountOption[], knownAccount?: Account): AccountChoiceRequest {
    const payload = draft.json();
    const history: JsonObject = {};
    const criteria: { [label: string]: string } = {};
    for (const option of options) {
        history[option.label] = {
            facts: optionFacts(payload, option),
            transactions: option.transactions.map(transaction => {
                const past = transaction.json();
                return transactionFacts(past, past.creditAccount && accountName(past.creditAccount), past.debitAccount && accountName(past.debitAccount));
            }),
        };
        criteria[option.label] = optionDescription(option);
    }

    return {
        state: {
            draft: transactionFacts(payload, knownName(payload.creditAccount, knownAccount), knownName(payload.debitAccount, knownAccount)),
            history,
        },
        questions: {
            [ACCOUNT_CHOICE_QUESTION]: { type: 'choice', instructions: INSTRUCTIONS, criteria },
        },
    };
}

/** The chosen option with the model's confidence in it, or undefined for a label that was not offered. */
export function decideAccountOption(options: AccountOption[], answer: AccountChoiceAnswer): AccountChoiceDecision | undefined {
    const option = options.find(candidate => candidate.label === answer.choice);
    return option ? { option, confidence: answer.confidence } : undefined;
}
