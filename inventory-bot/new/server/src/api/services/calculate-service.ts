import type { AppContext } from '../../shared/app-context.js';
import type { CalculateRequest, OperationResponse } from '../schemas.js';
import { type OperationContext, OperationService } from './operation-service.js';

export class CalculateService extends OperationService {
    static async execute(
        context: AppContext,
        bookId: string,
        accountId: string,
        request: CalculateRequest
    ): Promise<OperationResponse> {
        const operationContext = await this.resolveContext(context, bookId, accountId);
        await this.validateContext(operationContext);
        return this.run(operationContext, request);
    }

    /** Non-mutating placeholder retained until Calculate accounting is ported. */
    protected static async run(
        _context: OperationContext,
        _request: CalculateRequest
    ): Promise<OperationResponse> {
        return { message: '' };
    }
}
