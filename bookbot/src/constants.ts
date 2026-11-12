export const PARSED_ACCOUNT_NAME_PROPERTY = 'parsed_account_name_';
export const AGENT_PROMPT_SKIP_PROPERTY = 'agent_prompt_skip';
export const AGENT_EXCLUDED_PROPERTIES_PROPERTY = 'agent_excluded_properties';

// Bookbot's properties. Property keys have at most 30 characters.
export const BOOKBOT_CREDIT_ACCOUNT_ID_PROPERTY = 'bookbot_credit_account_id_';
export const BOOKBOT_DEBIT_ACCOUNT_ID_PROPERTY = 'bookbot_debit_account_id_';
export const BOOKBOT_DESCRIPTION_PART_PROPERTY = 'bookbot_description_part_';
export const BOOKBOT_DISCOVERED_PROPERTIES_PROPERTY = 'bookbot_discovered_properties_';
export const BOOKBOT_DISCOVERY_EXAMPLES_PROPERTY = 'bookbot_discovery_examples';

// Earlier names of the properties above. Read after the new name, never written; a draft Bookbot
// updates loses the earlier name of each provenance key it writes. Customer settings keep working.
export const LEGACY_AGENT_CREDIT_ACCOUNT_ID_PROPERTY = 'agent_credit_account_id_';
export const LEGACY_AGENT_DEBIT_ACCOUNT_ID_PROPERTY = 'agent_debit_account_id_';
export const LEGACY_AGENT_DESCRIPTION_PART_PROPERTY = 'agent_description_part_';
export const LEGACY_AGENT_DISCOVERED_PROPERTIES_PROPERTY = 'agent_discovered_properties_';
export const LEGACY_AGENT_DISCOVERY_EXAMPLES_PROPERTY = 'agent_discovery_examples';

// Bkper AI language models
export const GEMINI_MODEL_FLASH_LITE = 'gemini-flash-lite';
export const GEMINI_MODEL_FLASH = 'gemini-flash';
