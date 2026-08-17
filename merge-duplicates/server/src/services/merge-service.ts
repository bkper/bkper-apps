import { HTTPException } from 'hono/http-exception';
import type { AppContext } from '../app-context';
import { requireMergePermission } from './permission-service';

export interface MergeRequest {
    bookId: string;
    firstTransactionId: string;
    secondTransactionId: string;
}

export async function mergePair(
    context: AppContext,
    request: MergeRequest
): Promise<{ mergedTransactionId: string }> {
    const book = await context.bkper.getBook(request.bookId);
    requireMergePermission(book);
    const transaction = await book.mergeTransactions(
        request.firstTransactionId,
        request.secondTransactionId
    );
    const mergedTransactionId = transaction.getId();
    if (!mergedTransactionId) {
        throw new HTTPException(502, {
            message: 'Bkper merge returned no canonical transaction ID.',
        });
    }
    return { mergedTransactionId };
}
