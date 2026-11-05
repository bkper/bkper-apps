export type JsonSchemaType = 'null' | 'boolean' | 'object' | 'array' | 'number' | 'string' | 'integer';

export interface JsonSchema {
    type?: JsonSchemaType | readonly JsonSchemaType[];
    properties?: Readonly<Record<string, JsonSchema>>;
    required?: readonly string[];
    additionalProperties?: boolean | JsonSchema;
    items?: JsonSchema;
    enum?: readonly (string | number | boolean | null)[];
    anyOf?: readonly JsonSchema[];
    oneOf?: readonly JsonSchema[];
    allOf?: readonly JsonSchema[];
    $ref?: string;
    $defs?: Readonly<Record<string, JsonSchema>>;
    format?: string;
    pattern?: string;
    description?: string;
    minimum?: number;
    maximum?: number;
    minItems?: number;
    maxItems?: number;
}

export const DESCRIPTION_PARTS_SCHEMA: JsonSchema = {
    type: 'array',
    items: { type: 'string' },
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function matchesType(type: JsonSchemaType, value: unknown): boolean {
    if (type === 'null') return value === null;
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') return isRecord(value);
    if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    return typeof value === type;
}

export function validateStructuredValue(schema: JsonSchema, value: unknown): boolean {
    if (schema.anyOf && !schema.anyOf.some(item => validateStructuredValue(item, value))) return false;
    if (schema.oneOf) {
        const matches = schema.oneOf.filter(item => validateStructuredValue(item, value));
        if (matches.length !== 1) return false;
    }
    if (schema.allOf && !schema.allOf.every(item => validateStructuredValue(item, value))) return false;

    if (schema.type) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type];
        if (!types.some(type => matchesType(type, value))) return false;
    }
    if (schema.enum && !schema.enum.some(item => Object.is(item, value))) return false;
    if (typeof value === 'string') {
        if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) return false;
        if (schema.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
    }
    if (typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) return false;
        if (schema.maximum !== undefined && value > schema.maximum) return false;
    }
    if (Array.isArray(value)) {
        if (schema.minItems !== undefined && value.length < schema.minItems) return false;
        if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
        if (schema.items && value.some(item => !validateStructuredValue(schema.items!, item))) return false;
    }
    if (isRecord(value)) {
        const properties = schema.properties ?? {};
        if (schema.required?.some(name => !(name in value))) return false;
        for (const [name, item] of Object.entries(value)) {
            const propertySchema = properties[name];
            if (propertySchema) {
                if (!validateStructuredValue(propertySchema, item)) return false;
                continue;
            }
            if (schema.additionalProperties === false) return false;
            if (isRecord(schema.additionalProperties) &&
                !validateStructuredValue(schema.additionalProperties, item)) return false;
        }
    }
    return true;
}
