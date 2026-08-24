import type { Account, Book } from 'bkper-js';
import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../../shared/app-context.js';
import { requireAppInstallation, requireEditPermission } from '../authorization.js';
import { BotService } from './bot-service.js';

export interface OperationContext {
    portfolioBook: Book;
    portfolioAccount: Account;
    financialBook: Book;
    baseBook: Book;
}

export abstract class OperationService {
    protected static async validateContext(context: OperationContext): Promise<void> {
        requireEditPermission(context.portfolioBook);
        await requireAppInstallation(context.portfolioBook);

        requireEditPermission(context.financialBook);
        await requireAppInstallation(context.financialBook);

        if (context.baseBook.getId() !== context.financialBook.getId()) {
            requireEditPermission(context.baseBook);
            await requireAppInstallation(context.baseBook);
        }
    }

    protected static async resolveContext(
        context: AppContext,
        portfolioBookId: string,
        portfolioAccountId: string
    ): Promise<OperationContext> {
        const portfolioBook = await context.bkper.getBook(portfolioBookId, true);
        const portfolioBookName = portfolioBook.getName() ?? portfolioBookId;

        const portfolioAccount = await portfolioBook.getAccount(portfolioAccountId);
        if (!portfolioAccount) {
            throw new HTTPException(400, {
                message: `Account ${portfolioAccountId} was not found in Book ${portfolioBookName}.`,
            });
        }

        const accountName = portfolioAccount.getName() ?? portfolioAccountId;

        if (!portfolioAccount.isPermanent()) {
            throw new HTTPException(400, {
                message: `Account ${accountName} is non-permanent in Book ${portfolioBookName}.`,
            });
        }

        if (portfolioAccount.isArchived()) {
            throw new HTTPException(400, {
                message: `Account ${accountName} is archived in Book ${portfolioBookName}.`,
            });
        }

        const botService = new BotService();

        const accountExcCode = await botService.getAccountExcCode(portfolioAccount);
        if (!accountExcCode) {
            throw new HTTPException(400, {
                message: `Account ${accountName} has no configured exchange code in Book ${portfolioBookName}.`,
            });
        }

        const financialBook = botService.getFinancialBook(portfolioBook, accountExcCode);
        if (!financialBook) {
            throw new HTTPException(400, {
                message: `Financial Book for exchange code ${accountExcCode} was not found in the Collection of ${portfolioBookName}.`,
            });
        }

        const baseBook = botService.getBaseBook(portfolioBook);
        if (!baseBook) {
            throw new HTTPException(400, {
                message: `Base Book was not found in the Collection of ${portfolioBookName}.`,
            });
        }

        return { portfolioBook, portfolioAccount, financialBook, baseBook };
    }
}
