import type { AppContext } from '../../shared/app-context.js';
import { requireAppInstallation, requireViewPermission } from '../authorization.js';
import type { CalculateRequest, CalculateResult } from '../schemas.js';
import { BotService } from './bot-service.js';

export class CalculateService {
    static async listAccountsPendingCalculation(
        context: AppContext,
        bookId: string
    ): Promise<string[]> {
        const stockBook = await context.bkper.getBook(bookId, true);
        requireViewPermission(stockBook);
        await requireAppInstallation(stockBook);

        const botService = new BotService(context);
        const baseBook = botService.getBaseBook(stockBook);
        const accounts = await botService.getUncalculatedAccounts(stockBook, baseBook ?? undefined);
        const accountIds: string[] = [];
        for (const account of accounts) {
            const accountId = account.getId();
            if (accountId) {
                accountIds.push(accountId);
            }
        }
        return accountIds;
    }

    static async calculate(
        _context: AppContext,
        _bookId: string,
        _accountId: string,
        _request: CalculateRequest
    ): Promise<CalculateResult> {
        return { books: [] };
    }
}
