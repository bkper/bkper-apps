import { File } from 'bkper-js';

export function isCSVFile(file: File): boolean {
    const contentType = file.getContentType();
    const fileName = file.getName() || '';
    return contentType === 'text/csv' || contentType === 'application/csv' || fileName.toLowerCase().endsWith('.csv');
}

export function filterFileProperties(properties: Record<string, unknown> | undefined): Record<string, string> | undefined {
    if (!properties) {
        return undefined;
    }

    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(properties)) {
        if (shouldSkipFileProperty(key) || value === undefined || value === null) {
            continue;
        }
        const stringValue = String(value);
        if (stringValue.length > 0) {
            filtered[key] = stringValue;
        }
    }

    return filtered;
}

function shouldSkipFileProperty(key: string): boolean {
    if (!key.trim()) {
        return true;
    }
    if (key === 'transactions_summary') {
        return true;
    }
    return ['agent_', 'parsed_', 'account_id', 'group_id', 'upload_method', 'auto_filled_date_'].some((prefix) => key.startsWith(prefix));
}
