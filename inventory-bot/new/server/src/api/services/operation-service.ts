import type { Account, Book } from 'bkper-js';
import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../../shared/app-context.js';
import { optionalLookup } from '../../shared/optional-lookup.js';
import { requireAppInstallation, requireEditPermission } from '../authorization.js';
import { BotService } from './bot-service.js';

export interface OperationContext {
    inventoryBook: Book;
    inventoryAccount: Account;
    financialBook: Book;
}

/** Shared authoritative context and authorization boundary for Account operations. */
export abstract class OperationService {
    protected static async validateContext(context: OperationContext): Promise<void> {
        requireEditPermission(context.inventoryBook);
        await requireAppInstallation(context.inventoryBook);

        requireEditPermission(context.financialBook);
        await requireAppInstallation(context.financialBook);
    }

    protected static async resolveContext(
        context: AppContext,
        inventoryBookId: string,
        inventoryAccountId: string
    ): Promise<OperationContext> {
        const inventoryBook = await this.loadFullBook(context, inventoryBookId);
        const inventoryBookName = inventoryBook.getName() ?? inventoryBookId;

        const inventoryAccount = await optionalLookup(() =>
            inventoryBook.getAccount(inventoryAccountId)
        );
        if (!inventoryAccount) {
            throw new HTTPException(400, {
                message: `Account ${inventoryAccountId} was not found in Book ${inventoryBookName}.`,
            });
        }

        const accountName = inventoryAccount.getName() ?? inventoryAccountId;

        if (!inventoryAccount.isPermanent()) {
            throw new HTTPException(400, {
                message: `Account ${accountName} is non-permanent in Book ${inventoryBookName}.`,
            });
        }

        const botService = new BotService();

        const accountExcCode = await botService.getAccountExcCode(inventoryAccount);
        if (!accountExcCode) {
            throw new HTTPException(400, {
                message: `Account ${accountName} has no configured exchange code in Book ${inventoryBookName}.`,
            });
        }

        const financialBook = botService.getFinancialBook(inventoryBook, accountExcCode);
        if (!financialBook) {
            throw new HTTPException(400, {
                message: `Financial Book for exchange code ${accountExcCode} was not found in the Collection of ${inventoryBookName}.`,
            });
        }

        return { inventoryBook, inventoryAccount, financialBook };
    }

    protected static loadFullBook(context: AppContext, bookId: string): Promise<Book> {
        return context.bkper.getBook(bookId, true);
    }
}
