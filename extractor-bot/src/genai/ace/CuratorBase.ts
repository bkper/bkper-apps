import { GEMINI_MODEL_FLASH } from '../../constants.js';
import { BkperAIResponsesClient, type StructuredGenerationPart } from '../BkperAIResponsesClient.js';
import { GenAI } from '../GenAI.js';
import { GenAIRequestContext } from '../GenAITelemetry.js';
import { CURATION_SCHEMA, JsonSchema } from '../JsonSchema.js';
import { ReflectionResult } from './ReflectionResult.js';

export interface BulletExtractionResult {
  bullets: string[];
}

/**
 * Abstract base class for curators that extract new bullet points from reflection analysis.
 *
 * Follows ACE paper approach: Deterministic bullet appending
 * - Extracts ONLY new bullets to address failures
 * - Uses whatWorked as context for conflict avoidance
 * - Bullets are merged with existing prompt via BulletMerger (in service layer)
 *
 * Single Responsibility: Extract actionable bullets from reflection analysis
 */
export abstract class CuratorBase extends GenAI<BulletExtractionResult> {
  private reflection: ReflectionResult;

  constructor(reflection: ReflectionResult, env: Env, responsesClient?: BkperAIResponsesClient) {
    super(env, responsesClient);
    this.reflection = reflection;
  }

  getModel(): string {
    return GEMINI_MODEL_FLASH;
  }

  getOperation(): 'ace' {
    return 'ace';
  }

  getSystemPrompt(): string {
    return `You are an expert prompt engineer specializing in data extraction optimization.

Your task: Extract NEW, ACTIONABLE bullet points to address specific failures in data extraction.

Core principles:
- Focus PRIMARILY on what failed - generate bullets to fix failures
- Use "what worked" as CONTEXT ONLY to avoid conflicts with working patterns
- DO NOT generate bullets that contradict or modify working patterns
- Each bullet must be specific, actionable, and address a failure
- Ensure new bullets COMPLEMENT (not replace) working patterns
- Make instructions precise with structural markers (e.g., "column 3", "first row", "section header")
- Avoid vague guidance - be explicit and deterministic

IMPORTANT: Generate ONLY new instructions to fix failures. Do NOT:
- Reference or rewrite working patterns
- Try to "improve" what already works
- Create bullets that conflict with existing successful extraction patterns`;
  }

  getResponseSchema(): JsonSchema {
    return CURATION_SCHEMA;
  }

  /**
   * Extract new bullet points to address failures from reflection analysis.
   * This method follows the ACE paper approach of deterministically extracting
   * new bullets without regenerating the entire prompt.
   *
   * Uses whatWorked as conflict-avoidance context to ensure new bullets
   * complement (not contradict) existing working patterns.
   *
   * @returns Array of new bullet point strings, or undefined if extraction fails
   */
  async extractNewBullets(context: GenAIRequestContext = {}): Promise<string[] | undefined> {
    const { whatFailed } = this.reflection;

    // If no failures, return empty array
    if (!whatFailed || whatFailed.length === 0) {
      return [];
    }

    const contents: StructuredGenerationPart[] = [{ text: this.getDefaultUserPrompt() }];
    const result = await this.query(contents, context);
    return result?.bullets || undefined;
  }

  /**
   * Abstract method to be implemented by concrete curators.
   * Should return domain-specific user prompt content.
   */
  abstract getUserPrompt(): string;

  getDefaultUserPrompt(): string {
    const { whatWorked, whatFailed, suggestedImprovements } = this.reflection;

    return `
Working Patterns (DO NOT modify or contradict these):
${whatWorked?.map((w, i) => `${i + 1}. ${w}`).join('\n') || 'None specified'}

Extraction Failures to Address:
${whatFailed.map((f, i) => `${i + 1}. ${f}`).join('\n')}

Suggested Improvements:
${suggestedImprovements || 'None provided'}

${this.getUserPrompt()}

Generate ONLY new bullet points (without the "- " prefix) that address the failures above while avoiding conflicts with working patterns.

Each bullet should be:
1. Actionable and specific
2. Address at least one failure listed above
4. Be standalone (can be added to existing prompt)
5. COMPLEMENT (not contradict) the working patterns

Return ONLY new bullets to fix failures, not the entire prompt.`;
  }
}
