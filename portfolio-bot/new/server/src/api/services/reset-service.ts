import type { AppContext } from '../../shared/app-context.js';
import type { FullResetResult, ResetResult } from '../schemas.js';
import { OperationService } from './operation-service.js';

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
        return { books: [] };
    }
}
