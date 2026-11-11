import { BkperAIResponsesClient } from '../BkperAIResponsesClient.js';
import { File } from 'bkper-js';
import { GEMINI_MODEL_FLASH } from '../../constants.js';
import { ExtractedTransaction } from '../ExtractedTransaction.js';
import { GenAIFile } from '../GenAIFile.js';
import { GenAIRequestContext } from '../GenAITelemetry.js';
import { JsonSchema, REFLECTION_SCHEMA } from '../JsonSchema.js';
import { ReflectionResult } from './ReflectionResult.js';

/**
 * Base class for reflection analysis of extraction quality.
 *
 * Reflectors compare AI-extracted data with user-corrected data to identify
 * patterns of success and failure, generating insights for prompt improvement.
 */
export abstract class ReflectorBase extends GenAIFile<ReflectionResult> {
  constructor(file: File, env: Env, responsesClient?: BkperAIResponsesClient) {
    super(file, env, responsesClient);
  }

  getModel(): string {
    return GEMINI_MODEL_FLASH;
  }

  getOperation(): 'ace' {
    return 'ace';
  }

  /**
   * Domain-specific system prompt defining the reflector's role and focus areas.
   */
  abstract getSystemPrompt(): string;

  /**
   * Build the user prompt for reflection analysis.
   *
   * @param aiExtracted - Array of AI-extracted transactions
   * @param userCorrected - Array of user-corrected transactions
   * @param userRemoved - Array of transactions removed by user (optional, defaults to empty)
   * @param currentPrompt - Current extraction instructions (optional, for multi-epoch context)
   * @returns Formatted prompt string for the GenAI model
   */
  protected abstract buildUserPrompt(aiExtracted: ExtractedTransaction[], userCorrected: ExtractedTransaction[], userRemoved: ExtractedTransaction[], currentPrompt?: string): string;

  getDefaultUserPrompt(): string {
    // Not used - we use reflect() method with arrays
    return '';
  }

  getResponseSchema(): JsonSchema {
    return REFLECTION_SCHEMA;
  }

  /**
   * Analyze extraction quality by comparing AI-extracted data with user corrections.
   *
   * @param aiExtracted - Array of AI-extracted transactions
   * @param userCorrected - Array of user-corrected transactions (current state)
   * @param userRemoved - Array of transactions removed by user (trashed), defaults to empty array
   * @param currentPrompt - Current extraction instructions (optional, provides multi-epoch context)
   * @returns ReflectionResult with analysis of what worked, what failed, and suggestions
   */
  async reflect(aiExtracted: ExtractedTransaction[], userCorrected: ExtractedTransaction[], userRemoved: ExtractedTransaction[] = [], currentPrompt?: string, context: GenAIRequestContext = {}): Promise<ReflectionResult | undefined> {
    const userPrompt = this.buildUserPrompt(aiExtracted, userCorrected, userRemoved, currentPrompt);
    return await this.extract(userPrompt, context);
  }
}
