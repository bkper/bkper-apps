import { Book } from 'bkper-js';
import { Result } from './event-handler.js';
import { EventHandler } from './EventHandler.js';
import { StatementPromptImprovementService } from '../services/StatementPromptImprovementService.js';
import { AppContext } from '../AppContext.js';

/**
 * Handler for BOOK_AUDITED events.
 * Processes one flagged statement (LIFO) per audit to run ACE pipeline.
 * This prevents timeouts by limiting scope to single entity processing.
 */
export class EventHandlerBookAudited extends EventHandler {
    private statementPromptImprovementService: StatementPromptImprovementService;

    constructor(context: AppContext) {
        super(context);
        this.statementPromptImprovementService = new StatementPromptImprovementService(context);
    }

    async handleEvent(book: Book, event: bkper.Event): Promise<Result> {
        console.log('BOOK_AUDITED event - checking for flagged statements...');

        // 1. Get all flagged entities
        const flagged = await this.context.flagManagementService.getFlaggedEntity(book);

        if (flagged == null) {
            console.log('No statements flagged for improvement');
            return { result: 'No statements pending improvement' };
        }

        // 2. Run ACE pipeline
        const result = await this.statementPromptImprovementService.improveStatementPrompt(book, flagged);

        if (result) {
            return { result: `Statement ACE completed for ${flagged.getName()}: ${result}` };
        } else {
            return { result: `Statement ACE skipped for ${flagged.getName()} (validation failed or no changes needed)` };
        }
    }
}
