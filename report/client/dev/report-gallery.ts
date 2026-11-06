/// <reference types="vite/client" />
/**
 * Development-only gallery of the report renderer, served by `vite dev` at /dev/report.html.
 * It renders the recorded specs of `scripts/generate-report-specs.ts` (`specs/*.json`, and any
 * local ones of live Books in `specs/local/`), validated with the catalog.
 *
 * Query: `?only=<id>,<id>` renders some specs; `?width=<css length>` sets the column width.
 * The Bkper theme cookie (`bkper_theme`) chooses light or dark, as in the app.
 */
import '../src/styles.css';
import './report-gallery.css';
import { validateReportSpec } from 'report-shared/catalog';
import { EXPAND_ROW, OPEN_IN_BKPER } from '../src/report/index';

interface Entry {
    id: string;
    lang: string;
    spec: unknown;
}

function isEntry(value: unknown): value is Entry {
    return typeof value === 'object' && value !== null && 'id' in value && 'spec' in value;
}

const files = import.meta.glob<unknown[]>(['./specs/*.json', './specs/local/*.json'], {
    eager: true,
    import: 'default',
});
const params = new URLSearchParams(location.search);
const only = params.get('only')?.split(',');
const width = params.get('width');
const gallery = document.querySelector<HTMLElement>('#gallery');

if (gallery) {
    gallery.className = 'gallery';
    if (width) {
        gallery.style.setProperty('--gallery-width', width);
    }
    const entries = Object.entries(files).flatMap(([file, list]) =>
        list.filter(isEntry).map(entry => ({ ...entry, file: file.replace(/^.*\//, '') }))
    );
    for (const entry of entries) {
        if (only && !only.includes(entry.id)) {
            continue;
        }
        const validation = validateReportSpec(entry.spec);
        const section = document.createElement('section');
        section.className = 'gallery-entry';
        section.dataset.id = entry.id;
        const heading = document.createElement('h2');
        heading.textContent = `${entry.file} · ${entry.id} · ${entry.lang}`;
        section.append(heading);
        if (validation.valid) {
            const view = document.createElement('report-view');
            view.spec = validation.spec;
            section.append(view);
        } else {
            const issues = document.createElement('pre');
            issues.textContent = validation.issues.join('\n');
            section.append(issues);
        }
        gallery.append(section);
    }
    gallery.addEventListener(EXPAND_ROW, event => console.info(EXPAND_ROW, event.detail));
    gallery.addEventListener(OPEN_IN_BKPER, event => console.info(OPEN_IN_BKPER, event.detail));
}
