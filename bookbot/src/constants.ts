export const PARSED_ACCOUNT_NAME_PROPERTY = 'parsed_account_name_';
export const AGENT_PROMPT_SKIP_PROPERTY = 'agent_prompt_skip';
export const AGENT_EXCLUDED_PROPERTIES_PROPERTY = 'agent_excluded_properties';
/** Set by Extractor Bot on drafts it records from a file; earlier drafts carry the legacy name. */
export const EXTRACTOR_FILE_ID_PROPERTY = 'extractor_file_id_';
export const LEGACY_AGENT_FILE_ID_PROPERTY = 'agent_file_id_';
/** Set by Bkper when a created transaction's date was filled in automatically, not chosen by the user. */
export const AUTO_FILLED_DATE_PROPERTY = 'auto_filled_date_';

// Bookbot's properties. Property keys have at most 30 characters.
export const BOOKBOT_CREDIT_ACCOUNT_ID_PROPERTY = 'bookbot_credit_account_id_';
export const BOOKBOT_DEBIT_ACCOUNT_ID_PROPERTY = 'bookbot_debit_account_id_';
// No longer written: discovery removes it, under either name, from the drafts where it fills a side.
export const BOOKBOT_DESCRIPTION_PART_PROPERTY = 'bookbot_description_part_';
export const BOOKBOT_DISCOVERED_PROPERTIES_PROPERTY = 'bookbot_discovered_properties_';
/** Jev's confidence in the Accounts discovery filled, such as `0.93`. */
export const BOOKBOT_CONFIDENCE_PROPERTY = 'bookbot_confidence_';

// Earlier names of the properties above. Read after the new name, never written; a draft Bookbot
// updates loses the earlier name of each provenance key it writes.
export const LEGACY_AGENT_CREDIT_ACCOUNT_ID_PROPERTY = 'agent_credit_account_id_';
export const LEGACY_AGENT_DEBIT_ACCOUNT_ID_PROPERTY = 'agent_debit_account_id_';
export const LEGACY_AGENT_DESCRIPTION_PART_PROPERTY = 'agent_description_part_';
export const LEGACY_AGENT_DISCOVERED_PROPERTIES_PROPERTY = 'agent_discovered_properties_';

// Bkper AI language models
export const GEMINI_MODEL_FLASH_LITE = 'gemini-flash-lite';
export const GEMINI_MODEL_FLASH = 'gemini-flash';
