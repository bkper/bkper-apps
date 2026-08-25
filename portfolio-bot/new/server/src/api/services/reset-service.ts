import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../../shared/app-context.js';
import { requireOwnerPermission } from '../authorization.js';
import { BotService } from './bot-service.js';
import { type OperationContext, OperationService } from './operation-service.js';

export class ResetService extends OperationService {
    static async reset(context: AppContext, bookId: string, accountId: string): Promise<void> {
        const operationContext = await this.resolveContext(context, bookId, accountId);
        await this.validateContext(operationContext);
    }

    static async fullReset(context: AppContext, bookId: string, accountId: string): Promise<void> {
        const operationContext = await this.resolveContext(context, bookId, accountId);
        await this.validateContext(operationContext);
        this.validateFullResetContext(operationContext);
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
