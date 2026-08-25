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
    }
}
