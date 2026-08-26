import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../../shared/app-context.js';
import { requireAppInstallation, requireViewPermission } from '../authorization.js';
import type { CalculateRequest, OperationResponse } from '../schemas.js';
import { BotService } from './bot-service.js';
import { CalculateRealizedResultsService } from './calculate/calculate-realized-results-service.js';
import { OperationService } from './operation-service.js';
import { SummaryState } from './summary.js';

export class CalculateService extends OperationService {
    static async listAccountsPendingCalculation(
        context: AppContext,
        bookId: string
    ): Promise<string[]> {
        // Pending calculation scans the Portfolio chart and only reads Base Book
        // exchange-code metadata, so no additional full Book load is needed.
        const portfolioBook = await this.loadFullBook(context, bookId);
        requireViewPermission(portfolioBook);
        await requireAppInstallation(portfolioBook);

        const botService = new BotService();
        const baseBook = botService.getBaseBook(portfolioBook);
        const accounts = await botService.getUncalculatedAccounts(
            portfolioBook,
            baseBook ?? undefined
        );

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
        context: AppContext,
        bookId: string,
        accountId: string,
        request: CalculateRequest
    ): Promise<OperationResponse> {
        const operationContext = await this.resolveContext(context, bookId, accountId);
        await this.validateContext(operationContext);

        // Calculate resolves and creates Accounts across the Financial and Base charts,
        // so replace their Collection metadata Books before entering calculation logic.
        const financialBookId = operationContext.financialBook.getId();
        const baseBookId = operationContext.baseBook.getId();

        const financialBook = await this.loadFullBook(context, financialBookId);
        const baseBook =
            baseBookId === financialBookId
                ? financialBook
                : await this.loadFullBook(context, baseBookId);

        operationContext.financialBook = financialBook;
        operationContext.baseBook = baseBook;

        const summary = await new CalculateRealizedResultsService().calculateAccount(
            operationContext,
            request.performMtm,
            request.date
        );
        if (summary.getState() === SummaryState.LOCKED) {
            throw new HTTPException(400, { message: summary.getMessage() });
        }

        return { message: summary.getMessage() };
    }
}
