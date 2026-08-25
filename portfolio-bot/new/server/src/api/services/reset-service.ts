import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../../shared/app-context.js';
import { requireOwnerPermission } from '../authorization.js';
import type { FullResetResult, ResetResult } from '../schemas.js';
import { BotService } from './bot-service.js';
import { type OperationContext, OperationService } from './operation-service.js';

export class ResetService extends OperationService {
    static async reset(
        context: AppContext,
        bookId: string,
        accountId: string
    ): Promise<ResetResult> {
        const operationContext = await this.resolveContext(context, bookId, accountId);
        await this.validateContext(operationContext);
        return { books: [] };
    }

    static async fullReset(
        context: AppContext,
        bookId: string,
        accountId: string
    ): Promise<FullResetResult> {
        const operationContext = await this.resolveContext(context, bookId, accountId);
        await this.validateContext(operationContext);
        this.validateFullResetContext(operationContext);
        return { books: [] };
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
