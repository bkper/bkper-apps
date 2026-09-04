import type { AppContext } from '../../shared/app-context.js';
import type { OperationResponse } from '../schemas.js';
import { type OperationContext, OperationService } from './operation-service.js';

export class ResetService extends OperationService {
    static async execute(
        context: AppContext,
        bookId: string,
        accountId: string
    ): Promise<OperationResponse> {
        const operationContext = await this.resolveContext(context, bookId, accountId);
        await this.validateContext(operationContext);
        return this.run(operationContext);
    }

    /** Non-mutating placeholder retained until Reset accounting is ported. */
    protected static async run(_context: OperationContext): Promise<OperationResponse> {
        return { message: '' };
    }
}
