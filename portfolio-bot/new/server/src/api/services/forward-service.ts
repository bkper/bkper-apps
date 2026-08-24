import type { AppContext } from '../../shared/app-context.js';
import type { ForwardRequest, ForwardResult } from '../schemas.js';
import { OperationService } from './operation-service.js';

export class ForwardService extends OperationService {
    static async forward(
        context: AppContext,
        bookId: string,
        accountId: string,
        _request: ForwardRequest
    ): Promise<ForwardResult> {
        await this.resolveContext(context, bookId, accountId);
        return { books: [] };
    }
}
