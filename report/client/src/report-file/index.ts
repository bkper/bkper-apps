/**
 * Entry of the report file bundle (`vite.report-file.config.ts`): the report renderer with the
 * Web Awesome theme and `@bkper/web-design` tokens, in one script and one stylesheet that the
 * Worker inlines into each report file.
 */
import './report-file.css';
import '../report/index.js';
import { startReportFile } from './report-file.js';

startReportFile(document, matchMedia('(prefers-color-scheme: dark)'), window);
