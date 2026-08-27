import type { OperationContext } from '../operation-service.js';
import type { Summary } from '../summary.js';

export class ForwardDateService {
    async execute(_context: OperationContext, _forwardDate: string): Promise<Summary> {
        throw new Error('Forward Date is not implemented');
    }
}
