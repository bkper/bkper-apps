import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../../shared/app-context.js';
import type { ForwardRequest, OperationResponse } from '../schemas.js';
import { OperationService } from './operation-service.js';
import { ForwardDateService } from './forward/forward-date-service.js';
import { SummaryState } from './summary.js';

export class ForwardService extends OperationService {
    /**
     * Preflights and prepares Forward Date execution for one Portfolio Account.
     *
     * @param context - Request-scoped Bkper application context.
     * @param bookId - Portfolio Book id.
     * @param accountId - Portfolio Account id to forward.
     * @param request - Requested forward date.
     *
     * @returns A response containing the Forward Date status message.
     * @throws When context or Forward Date validation fails.
     */
    static async execute(
        context: AppContext,
        bookId: string,
        accountId: string,
        request: ForwardRequest
    ): Promise<OperationResponse> {
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

        const summary = await new ForwardDateService().execute(operationContext, request.date);
        if (summary.getState() === SummaryState.FORWARD_ERROR) {
            throw new HTTPException(400, { message: summary.getMessage() });
        }

        return { message: summary.getMessage() };
    }
}
