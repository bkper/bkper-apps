import type { AppContext } from '../../shared/app-context.js';
import type { OperationResponse } from '../schemas.js';

export class ResetService {
    static async execute(
        _context: AppContext,
        _bookId: string,
        _accountId: string
    ): Promise<OperationResponse> {
        return { message: '' };
    }
}
