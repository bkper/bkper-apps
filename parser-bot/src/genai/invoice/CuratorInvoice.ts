import { File } from 'bkper-js';
import { CuratorBase } from '../ace/CuratorBase.js';
import { ReflectionResult } from '../ace/ReflectionResult.js';

/**
 * CuratorInvoice improves invoice/receipt extraction prompts based on
 * reflection analysis of extraction quality.
 */
export class CuratorInvoice extends CuratorBase {
    getUserPrompt(): string {
        return 'Improve the prompt for invoice/receipt extraction.';
    }

}
