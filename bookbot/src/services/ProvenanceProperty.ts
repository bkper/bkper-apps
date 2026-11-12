import { Transaction } from 'bkper-js';

/**
 * Writes a provenance property under its current name and removes its earlier name from the same draft,
 * only when present: removing an absent key would add an empty property to discovery results.
 */
export function setProvenanceProperty(draft: Transaction, property: string, legacyProperty: string, value: string): void {
    draft.setProperty(property, value);
    if (draft.getProperty(legacyProperty) !== undefined) {
        draft.deleteProperty(legacyProperty);
    }
}
