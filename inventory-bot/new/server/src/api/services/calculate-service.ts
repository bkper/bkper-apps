import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../../shared/app-context.js';
import type { CalculateRequest, OperationResponse } from '../schemas.js';
import { CalculateCostOfSalesService } from './calculate/calculate-cost-of-sales-service.js';
import { OperationService } from './operation-service.js';
import { SummaryState } from './summary.js';

export class CalculateService extends OperationService {
    static async execute(
        context: AppContext,
        bookId: string,
        accountId: string,
        request: CalculateRequest
    ): Promise<OperationResponse> {
        const operationContext = await this.resolveContext(context, bookId, accountId);
        await this.validateContext(operationContext);

        // Calculate resolves and creates Accounts across the Financial book, so replace
        // its Collection metadata Book before entering calculation logic.
        const financialBookId = operationContext.financialBook.getId();
        const financialBook = await this.loadFullBook(context, financialBookId);
        operationContext.financialBook = financialBook;

        const summary = await new CalculateCostOfSalesService().execute(
            operationContext,
            request.date
        );

        if (summary.getState() === SummaryState.LOCKED) {
            throw new HTTPException(400, { message: summary.getResult() });
        }
        return { message: summary.getResult() };
    }
}
