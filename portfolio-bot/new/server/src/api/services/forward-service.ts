import type { AppContext } from '../../shared/app-context.js';
import type { ForwardRequest } from '../schemas.js';
import { OperationService } from './operation-service.js';

export class ForwardService extends OperationService {
    static async forward(
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
