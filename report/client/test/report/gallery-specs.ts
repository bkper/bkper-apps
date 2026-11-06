/** The recorded specs of the gallery, validated, for renderer tests. */
import { validateReportSpec, type ReportElement, type ReportSpec } from 'report-shared/catalog';
import ledger from '../../dev/specs/ledger.json';
import studio from '../../dev/specs/studio.json';

const entries: unknown[] = [...studio, ...ledger];

export function gallerySpec(id: string): ReportSpec {
    const entry = entries.find(
        (candidate): candidate is { id: string; spec: unknown } =>
            typeof candidate === 'object' &&
            candidate !== null &&
            'id' in candidate &&
            candidate.id === id
    );
    if (!entry) {
        throw new Error(`No gallery spec ${id}`);
    }
    const validation = validateReportSpec(entry.spec);
    if (!validation.valid) {
        throw new Error(`Invalid gallery spec ${id}: ${validation.issues.join('; ')}`);
    }
    return validation.spec;
}

export function galleryIds(): string[] {
    return entries.flatMap(entry =>
        typeof entry === 'object' && entry !== null && 'id' in entry && typeof entry.id === 'string'
            ? [entry.id]
            : []
    );
}

export function elementOf<T extends ReportElement['type']>(
    spec: ReportSpec,
    type: T
): Extract<ReportElement, { type: T }> {
    const element = Object.values(spec.elements).find(
        (candidate): candidate is Extract<ReportElement, { type: T }> => candidate.type === type
    );
    if (!element) {
        throw new Error(`No ${type} in the spec`);
    }
    return element;
}
