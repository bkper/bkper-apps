import type { AppContext } from '../../shared/app-context.js';
import type { FullResetResult, ResetResult } from '../schemas.js';
import { OperationService } from './operation-service.js';

export class ResetService extends OperationService {
    static async reset(
        context: AppContext,
        bookId: string,
        accountId: string
    ): Promise<ResetResult> {
        await this.resolveContext(context, bookId, accountId);
        return { books: [] };
    }

    static async fullReset(
        context: AppContext,
        bookId: string,
        accountId: string
    ): Promise<FullResetResult> {
        await this.resolveContext(context, bookId, accountId);
        return { books: [] };
    }
}
