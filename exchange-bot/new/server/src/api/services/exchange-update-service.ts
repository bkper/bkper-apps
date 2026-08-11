import {
    Account,
    AccountType,
    Amount,
    type BalancesReport,
    type Book,
    type Group,
    Transaction,
} from 'bkper-js';
import type { AppContext } from '../../shared/app-context.js';
import { requireEditPermission } from '../authorization.js';
import type { ExchangeRates, ExchangeUpdateResult } from '../schemas.js';
import {
    EXC_ACCOUNT_PROP,
    EXC_AGGREGATE,
    EXC_AMOUNT_PROP,
    EXC_CODE_PROP,
    EXC_RATE_PROP,
    STOCK_EXC_CODE_PROP,
} from '../../shared/constants.js';
import { optionalLookup } from '../../shared/optional-lookup.js';
import { BotService } from './bot-service.js';
import { type ConvertedAmount, ExchangeService } from './exchange-service.js';

export class ExchangeUpdateService {
    static async update(
        context: AppContext,
        bookId: string,
        exchangeRates: ExchangeRates
    ): Promise<ExchangeUpdateResult> {
        const book = await context.bkper.getBook(bookId, true);
        requireEditPermission(book);

        const botService = new BotService(context);
        const connectedBooks = await botService.getConnectedBooks(book);
        const baseCode = botService.getBaseCode(book);
        const bookClosingDate = book.getClosingDate();
        const historical = botService.isHistorical(book);
        const date = botService.parseDateParam(exchangeRates.date);
        const query = getQuery(book, date, bookClosingDate, historical);
        const histQuery = getHistQuery(book, date);
        const bookBalancesReport = await book.getBalancesReport(query);
        const bookHistBalancesReport = historical ? null : await book.getBalancesReport(histQuery);

        const createdTransactions: bkper.Transaction[] = [];
        const createdAccounts: bkper.Account[] = [];

        for (let connectedBook of connectedBooks) {
            const connectedCode = botService.getBaseCode(connectedBook);
            const accounts = await getMatchingAccounts(book, connectedCode!);
            if (accounts.size === 0) {
                continue;
            }

            const transactions: Transaction[] = [];
            connectedBook = await context.bkper.getBook(connectedBook.getId(), true);

            const connectedBookBalancesReport = await connectedBook.getBalancesReport(query);
            const connectedBookHistBalancesReport =
                !historical && hasHistAccount(accounts)
                    ? await connectedBook.getBalancesReport(histQuery)
                    : null;

            for (const account of accounts) {
                const connectedAccount = await optionalLookup(() =>
                    connectedBook.getAccount(account.getName())
                );
                if (connectedAccount == null) {
                    continue;
                }
                if (historical && isHistAccount(connectedAccount)) {
                    continue;
                }

                const connectedAccountBalanceOnDate =
                    isHistAccount(connectedAccount) && connectedBookHistBalancesReport !== null
                        ? getAccountBalance(connectedBookHistBalancesReport, connectedAccount)
                        : getAccountBalance(connectedBookBalancesReport, connectedAccount);
                if (!connectedAccountBalanceOnDate) {
                    continue;
                }

                let expectedBalance: ConvertedAmount;
                try {
                    expectedBalance = ExchangeService.convert(
                        connectedAccountBalanceOnDate,
                        connectedCode!,
                        baseCode!,
                        exchangeRates
                    );
                } catch (error: unknown) {
                    console.log(
                        `Error: 'Invalid amount error' --->   BOOK: ${connectedBook.getName()}   //  ACCOUNT: ${connectedAccount.getName()}   //   DATE: ${date}   //   EXC_CODE: ${connectedCode}`
                    );
                    throw error;
                }

                const accountBalanceOnDate =
                    isHistAccount(connectedAccount) && bookHistBalancesReport !== null
                        ? getAccountBalance(bookHistBalancesReport, account)
                        : getAccountBalance(bookBalancesReport, account);
                if (!accountBalanceOnDate) {
                    continue;
                }

                let delta = accountBalanceOnDate.minus(expectedBalance.amount);
                const excAccountName = await getExcAccountName(
                    book,
                    connectedAccount,
                    connectedCode!
                );
                let excAccount = await optionalLookup(() => book.getAccount(excAccountName));
                if (excAccount == null) {
                    excAccount = new Account(book).setName(excAccountName);
                    const groups = await getExcAccountGroups(book);
                    for (const group of groups) {
                        excAccount.addGroup(group);
                    }
                    excAccount.setType(await getExcAccountType(book));
                    await excAccount.create();
                    createdAccounts.push(excAccount.json());
                }

                if (account.isCredit()) {
                    delta = delta.times(-1);
                }

                const deltaRounded = book.round(delta);
                const transaction = new Transaction(book)
                    .setDate(exchangeRates.date)
                    .setProperty(EXC_CODE_PROP, connectedCode)
                    .setProperty(EXC_RATE_PROP, expectedBalance.rate.toString())
                    .setProperty(EXC_AMOUNT_PROP, '0')
                    .setAmount(delta.abs());

                if (deltaRounded.gt(0)) {
                    transaction
                        .from(account)
                        .to(excAccount)
                        .setDescription(
                            isHistAccount(account) ? '#exchange_loss_hist' : '#exchange_loss'
                        );
                    transactions.push(transaction);
                } else if (deltaRounded.lt(0)) {
                    transaction
                        .from(excAccount)
                        .to(account)
                        .setDescription(
                            isHistAccount(account) ? '#exchange_gain_hist' : '#exchange_gain'
                        );
                    transactions.push(transaction);
                }
            }

            const created = await book.batchCreateTransactions(transactions);
            createdTransactions.push(...created.map(tx => tx.json()));
        }

        return { createdTransactions, createdAccounts };
    }
}

function getAccountBalance(balancesReport: BalancesReport, account: Account): Amount | null {
    try {
        return balancesReport.getBalancesContainer(account.getName()!).getCumulativeBalance();
    } catch {
        return null;
    }
}

async function getMatchingAccounts(book: Book, code: string): Promise<Set<Account>> {
    const accounts = new Map<string, Account>();
    const group = await optionalLookup(() => book.getGroup(code));
    if (group != null) {
        const groupAccounts = await group.getAccounts();
        for (const account of groupAccounts) {
            accounts.set(account.getId()!, account);
        }
    }

    const groups = await book.getGroups();
    for (const configuredGroup of groups) {
        if (configuredGroup.getProperty(EXC_CODE_PROP) == code) {
            const groupAccounts = await configuredGroup.getAccounts();
            for (const account of groupAccounts) {
                accounts.set(account.getId()!, account);
            }
        }
    }

    return new Set(accounts.values());
}

async function getExcAccountName(
    book: Book,
    connectedAccount: Account,
    connectedCode: string
): Promise<string> {
    let excAccount = connectedAccount.getProperty(EXC_ACCOUNT_PROP);
    if (excAccount) {
        return excAccount;
    }

    const groups = await connectedAccount.getGroups();
    for (const group of groups) {
        excAccount = group.getProperty(EXC_ACCOUNT_PROP);
        if (excAccount) {
            return excAccount;
        }
    }

    if (book.getProperty(EXC_AGGREGATE)) {
        return isHistAccount(connectedAccount)
            ? `Exchange_${connectedCode} Hist`
            : `Exchange_${connectedCode}`;
    }

    for (const group of groups) {
        if (group.getProperty(STOCK_EXC_CODE_PROP)) {
            return `${connectedAccount.getName()} Unrealized EXC`;
        }
    }

    return `${connectedAccount.getName()} EXC`;
}

function isHistAccount(account: Account): boolean {
    return account.getName()!.endsWith(' Hist');
}

function hasHistAccount(accounts: Set<Account>): boolean {
    for (const account of accounts) {
        if (isHistAccount(account)) {
            return true;
        }
    }
    return false;
}

async function getExcAccountGroups(book: Book): Promise<Set<Group>> {
    const accountNames = new Set<string>();
    const bookAccounts = await book.getAccounts();
    for (const account of bookAccounts) {
        const accountName = account.getProperty(EXC_ACCOUNT_PROP);
        if (accountName) {
            accountNames.add(accountName);
        }
        const name = account.getName()!;
        if (name.startsWith('Exchange_')) {
            accountNames.add(name);
        }
        if (name.endsWith(' EXC')) {
            accountNames.add(name);
        }
    }

    const groups = new Map<string, Group>();
    for (const accountName of accountNames) {
        const account = await optionalLookup(() => book.getAccount(accountName));
        if (account) {
            for (const group of await account.getGroups()) {
                groups.set(group.getId()!, group);
            }
        }
    }
    return new Set(groups.values());
}

async function getExcAccountType(book: Book): Promise<AccountType> {
    const accountNames = new Set<string>();
    const bookAccounts = await book.getAccounts();
    for (const account of bookAccounts) {
        const excAccount = account.getProperty(EXC_ACCOUNT_PROP);
        if (excAccount) {
            accountNames.add(excAccount);
        }
        const name = account.getName()!;
        if (name.startsWith('Exchange_')) {
            accountNames.add(name);
        }
        if (name.endsWith(' EXC')) {
            accountNames.add(name);
        }
    }

    const accountTypes = new Map<AccountType, Account[]>();
    for (const accountName of accountNames) {
        const account = await optionalLookup(() => book.getAccount(accountName));
        if (account) {
            const accountType = account.getType();
            const mappedAccounts = accountTypes.get(accountType);
            if (mappedAccounts) {
                mappedAccounts.push(account);
            } else {
                accountTypes.set(accountType, [account]);
            }
        }
    }

    let maxOccurrencesType = AccountType.LIABILITY;
    let maxOccurrences = 1;
    for (const [accountType, accounts] of accountTypes) {
        if (accounts.length > maxOccurrences) {
            maxOccurrences = accounts.length;
            maxOccurrencesType = accountType;
        }
    }
    return maxOccurrencesType;
}

function getQuery(
    book: Book,
    date: Date,
    bookClosingDate: string | undefined,
    historical: boolean
): string {
    const dateAfter = new Date(date.getTime());
    dateAfter.setDate(dateAfter.getDate() + 1);
    if (!historical && bookClosingDate) {
        let openingDate: Date;
        try {
            const closingDate = new Date();
            closingDate.setTime(book.parseDate(bookClosingDate).getTime());
            closingDate.setDate(closingDate.getDate() + 1);
            openingDate = closingDate;
        } catch {
            throw `Error parsing book closing date: ${bookClosingDate}`;
        }
        return `after:${book.formatDate(openingDate)} before:${book.formatDate(dateAfter)}`;
    }
    return `before:${book.formatDate(dateAfter)}`;
}

function getHistQuery(book: Book, date: Date): string {
    const dateAfter = new Date(date.getTime());
    dateAfter.setDate(dateAfter.getDate() + 1);
    return `before:${book.formatDate(dateAfter)}`;
}
