import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../../shared/app-context.js';
import { requireOwnerPermission } from '../authorization.js';
import type { OperationResponse } from '../schemas.js';
import { BotService } from './bot-service.js';
import { type OperationContext, OperationService } from './operation-service.js';
import { ResetRealizedResultsService } from './reset/reset-realized-results-service.js';
import { SummaryState } from './summary.js';

export class ResetService extends OperationService {
    /**
     * Resets realized results for one Portfolio Account.
     *
     * @param context - Request-scoped Bkper application context.
     * @param bookId - Portfolio Book id.
     * @param accountId - Portfolio Account id to reset.
     *
     * @returns A response containing the reset status message.
     * @throws When context validation fails or Reset encounters a locked movement.
     */
    static async execute(
        context: AppContext,
        bookId: string,
        accountId: string
    ): Promise<OperationResponse> {
        const operationContext = await this.resolveContext(context, bookId, accountId);
        await this.validateContext(operationContext);

        // Reset only queries and trashes linked Transactions in Financial and Base Books,
        // so their resolved Collection metadata is sufficient and no extra chart load is needed.
        return this.runReset(operationContext, false);
    }

    /**
     * Fully resets realized and forward state for one Portfolio Account.
     *
     * @param context - Request-scoped Bkper application context.
     * @param bookId - Portfolio Book id.
     * @param accountId - Portfolio Account id to fully reset.
     *
     * @returns A response containing the full-reset status message.
     * @throws When context, ownership, Collection lock, or movement lock validation fails.
     */
    static async executeFull(
        context: AppContext,
        bookId: string,
        accountId: string
    ): Promise<OperationResponse> {
        const operationContext = await this.resolveContext(context, bookId, accountId);
        await this.validateContext(operationContext);

        // Full Reset has the same Book chart requirements as regular Reset.
        this.validateFullResetContext(operationContext);
        return this.runReset(operationContext, true);
    }

    private static async runReset(
        context: OperationContext,
        full: boolean
    ): Promise<OperationResponse> {
        const summary = await new ResetRealizedResultsService().execute(context, full);
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
