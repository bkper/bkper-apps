import { REPORT_FILE_DATA_ID, type ReportFileData } from 'report-shared/report-file';
import { afterEach, describe, expect, it } from 'vitest';
import '../../src/report/index';
import { followColorScheme, startReportFile } from '../../src/report-file/report-file';
import { gallerySpec } from '../report/gallery-specs';

class FakeColorScheme extends EventTarget {
    constructor(public matches: boolean) {
        super();
    }

    change(matches: boolean): void {
        this.matches = matches;
        this.dispatchEvent(new Event('change'));
    }
}

afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.classList.remove('wa-dark');
});

describe('report file', () => {
    it('follows the viewer’s light or dark color scheme', () => {
        const root = document.createElement('html');
        const scheme = new FakeColorScheme(true);
        followColorScheme(root, scheme);
        expect(root.classList.contains('wa-dark')).toBe(true);
        scheme.change(false);
        expect(root.classList.contains('wa-dark')).toBe(false);
    });

    it('renders the report and the link the file carries', async () => {
        const data: ReportFileData = {
            spec: gallerySpec('revenue-total'),
            link: { url: 'https://report.bkper.app/?book=b&q=expenses', label: 'Open in Report' },
        };
        const script = document.createElement('script');
        script.type = 'application/json';
        script.id = REPORT_FILE_DATA_ID;
        script.textContent = JSON.stringify(data);
        document.body.append(document.createElement('report-view'), script);

        const view = startReportFile(document, new FakeColorScheme(false));

        expect(view?.spec).toEqual(data.spec);
        expect(view?.link).toEqual(data.link);
        await view?.updateComplete;
        expect(view?.shadowRoot?.querySelector('.answer-amount')?.textContent).toBeTruthy();
    });

    it('renders nothing without data', () => {
        document.body.append(document.createElement('report-view'));
        expect(startReportFile(document, new FakeColorScheme(false))).toBeUndefined();
    });
});
