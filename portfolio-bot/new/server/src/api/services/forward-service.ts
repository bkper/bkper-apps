import type { AppContext } from '../../shared/app-context.js';
import type { ForwardRequest } from '../schemas.js';
import { OperationService } from './operation-service.js';

export class ForwardService extends OperationService {
    /**
     * Preflights and prepares Forward Date execution for one Portfolio Account.
     *
     * @param context - Request-scoped Bkper application context.
     * @param bookId - Portfolio Book id.
     * @param accountId - Portfolio Account id to forward.
     * @param request - Requested forward date.
     * 
     * @returns A Promise that resolves after operation context preparation.
     * @throws When context validation fails.
     */
    static async execute(
        context: AppContext,
        bookId: string,
        accountId: string,
        _request: ForwardRequest
    ): Promise<void> {
        const operationContext = await this.resolveContext(context, bookId, accountId);
        await this.validateContext(operationContext);

        // Forward resolves and creates Accounts only in the Financial chart. Keep a distinct
        // Base Book metadata-only, or reuse the full Financial Book when both roles share an id.
        const financialBookId = operationContext.financialBook.getId();
        const baseBookId = operationContext.baseBook.getId();

        const financialBook = await this.loadFullBook(context, financialBookId);
        operationContext.financialBook = financialBook;
        if (baseBookId === financialBookId) {
            operationContext.baseBook = financialBook;
        }
    }
}
