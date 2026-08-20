import type { AppContext } from '../../shared/app-context.js';
import type { CalculateRequest, CalculateResult } from '../schemas.js';

export class CalculateService {
    static async listPendingCalculationAccountIds(
        _context: AppContext,
        _bookId: string
    ): Promise<string[]> {
        return [];
    }

    static async calculate(
        _context: AppContext,
        _bookId: string,
        _accountId: string,
        _request: CalculateRequest
    ): Promise<CalculateResult> {
        return { books: [] };
    }
}
