import type { ReportSpec } from './catalog';
import { withoutIsolates } from './bidi';

/**
 * The request a report answers, as plain words: its title and its period as asked, so editing
 * it keeps a relative period relative; for a spec written before it said so, its title and the
 * period it read.
 */
export function reportText(spec: ReportSpec): string {
    const root = spec.elements[spec.root];
    return root?.type === 'Report'
        ? withoutIsolates(root.props.request ?? `${root.props.title} ${root.props.subtitle}`).trim()
        : '';
}
