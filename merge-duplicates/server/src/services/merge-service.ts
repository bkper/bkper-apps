import type { AppContext } from '../app-context';
import { requireMergePermission } from './permission-service';

export interface MergeRequest {
    bookId: string;
    primary: bkper.Transaction & { id: string };
    secondary: bkper.Transaction & { id: string };
}

export async function mergePair(
    context: AppContext,
    request: MergeRequest
): Promise<bkper.Transaction> {
    const book = await context.bkper.getBook(request.bookId);
    requireMergePermission(book);
    const transaction = await book.mergeTransactions(request.primary, request.secondary);
    return transaction.json();
}
