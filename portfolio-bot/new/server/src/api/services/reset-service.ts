import type { AppContext } from '../../shared/app-context.js';
import type { FullResetResult, ResetResult } from '../schemas.js';

export class ResetService {
    static async reset(
        _context: AppContext,
        _bookId: string,
        _accountId: string
    ): Promise<ResetResult> {
        return { books: [] };
    }

    static async fullReset(
        _context: AppContext,
        _bookId: string,
        _accountId: string
    ): Promise<FullResetResult> {
        return { books: [] };
    }
}
