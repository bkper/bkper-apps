import type { AppContext } from '../../shared/app-context.js';
import type { ForwardRequest, ForwardResult } from '../schemas.js';

export class ForwardService {
    static async forward(
        _context: AppContext,
        _bookId: string,
        _accountId: string,
        _request: ForwardRequest
    ): Promise<ForwardResult> {
        return { books: [] };
    }
}
