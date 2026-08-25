import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../../shared/app-context.js';
import { requireOwnerPermission } from '../authorization.js';
import type { OperationResponse } from '../schemas.js';
import { BotService } from './bot-service.js';
import { type OperationContext, OperationService } from './operation-service.js';
import { ResetRealizedResultsService } from './reset/reset-realized-results-service.js';
import { StockAccount } from './stock-account.js';
import { SummaryState } from './summary.js';

export class ResetService extends OperationService {
    static async reset(
        context: AppContext,
        bookId: string,
        accountId: string
    ): Promise<OperationResponse> {
        const operationContext = await this.resolveContext(context, bookId, accountId);
        await this.validateContext(operationContext);
        return this.runReset(operationContext, false);
    }

    static async fullReset(
        context: AppContext,
        bookId: string,
        accountId: string
    ): Promise<OperationResponse> {
        const operationContext = await this.resolveContext(context, bookId, accountId);
        await this.validateContext(operationContext);
        this.validateFullResetContext(operationContext);
        return this.runReset(operationContext, true);
    }

    private static async runReset(
        context: OperationContext,
        full: boolean
    ): Promise<OperationResponse> {
        const stockAccount = new StockAccount(context.portfolioAccount);
        const summary = await new ResetRealizedResultsService().resetRealizedResultsForAccountAsync(
            context.portfolioBook,
            stockAccount,
            full,
            context.financialBook,
            context.baseBook
        );
        if (summary.getState() === SummaryState.LOCKED) {
            throw new HTTPException(400, { message: summary.getMessage() });
        }
        return { message: summary.getMessage() };
    }

    private static validateFullResetContext(context: OperationContext): void {
        requireOwnerPermission(context.portfolioBook);
        const collection = context.portfolioBook.getCollection()!;
        const botService = new BotService();
        if (collection.getBooks().some(b => !botService.isBookOpenAndUnlocked(b))) {
            throw new HTTPException(400, {
                message:
                    'Full Reset requires every Book in the Collection to be open and unlocked.',
            });
        }
    }
}
