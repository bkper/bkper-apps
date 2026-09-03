import type { AppContext } from '../../shared/app-context.js';
import type { CalculateRequest, OperationResponse } from '../schemas.js';

export class CalculateService {
    static async execute(
        _context: AppContext,
        _bookId: string,
        _accountId: string,
        _request: CalculateRequest
    ): Promise<OperationResponse> {
        return { message: '' };
    }
}
