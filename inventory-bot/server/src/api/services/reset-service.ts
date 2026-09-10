import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../../shared/app-context.js';
import type { OperationResponse } from '../schemas.js';
import { OperationService } from './operation-service.js';
import { ResetCostOfSalesService } from './reset/reset-cost-of-sales-service.js';
import { SummaryState } from './summary.js';

export class ResetService extends OperationService {
    static async execute(
        context: AppContext,
        bookId: string,
        accountId: string
    ): Promise<OperationResponse> {
        const operationContext = await this.resolveContext(context, bookId, accountId);
        await this.validateContext(operationContext);

        const summary = await new ResetCostOfSalesService().execute(operationContext);
        if (summary.getState() === SummaryState.LOCKED) {
            throw new HTTPException(400, { message: summary.getResult() });
        }
        return { message: summary.getResult() };
    }
}
